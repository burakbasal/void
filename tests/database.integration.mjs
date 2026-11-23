/**
 * Real Supabase integration checks. No mocked database or service transport.
 * Creates three temporary confirmed auth users and removes them in finally,
 * or uses three externally managed test accounts supplied through a private file.
 * Run only against a dedicated development/test project with VOID migrated.
 *
 * node --env-file=.env.local tests/database.integration.mjs
 * Required: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 * (or NEXT_PUBLIC_SUPABASE_ANON_KEY), SUPABASE_SERVICE_ROLE_KEY.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const externalFixturePath = process.env.VOID_TEST_FIXTURES_PATH;
// External-fixture mode never reads an administrative credential.
const service = externalFixturePath ? undefined : process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || (!externalFixturePath && !service)) {
  console.error('Missing test backend credentials. Set the public Supabase URL/key plus either SUPABASE_SERVICE_ROLE_KEY or VOID_TEST_FIXTURES_PATH. No checks ran.');
  process.exit(1);
}

let externalFixtures;
if (externalFixturePath) {
  let parsed;
  try { parsed = JSON.parse(await readFile(externalFixturePath, 'utf8')); }
  catch { throw new Error('Cannot read external test fixtures. Supply a valid private JSON file with an accounts array.'); }
  const valid = Array.isArray(parsed?.accounts) && parsed.accounts.length >= 3 && parsed.accounts.slice(0, 3).every(account =>
    account && typeof account.id === 'string' && /^[0-9a-f-]{36}$/i.test(account.id)
    && typeof account.email === 'string' && account.email.includes('@')
    && typeof account.password === 'string' && account.password.length >= 12
    && typeof account.username === 'string' && /^[a-z][a-z0-9_]{2,23}$/.test(account.username));
  if (!valid || new Set(parsed.accounts.slice(0, 3).map(account => account.id)).size !== 3) {
    throw new Error('External test fixtures must provide three distinct existing accounts with id, email, password, and username.');
  }
  externalFixtures = parsed.accounts.slice(0, 3);
  console.log('Fixture lifecycle: external test accounts; only this run\'s rooms are deleted, profile/password changes are restored, and Auth accounts are preserved.');
} else {
  console.log('Fixture lifecycle: temporary administrative test accounts, deleted in finally.');
}

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = service ? createClient(url, service, options) : null;
const anonymous = createClient(url, key, options);
const prefix = `vtest${randomBytes(5).toString('hex')}`;
const users = [];
const channels = [];
const createdRooms = [];
const verificationClients = [];
let checks = 0;
let messageTimeout;

function ok(result, description) {
  assert.equal(result.error, null, `${description}: ${result.error?.message}`);
  checks += 1;
  return result.data;
}
function denied(result, description) {
  assert.ok(result.error, `${description}: operation unexpectedly succeeded`);
  checks += 1;
}
function empty(result, description) {
  const data = ok(result, description);
  assert.equal(data.length, 0, description);
  checks += 1;
}
function row(data) { return Array.isArray(data) ? data[0] : data; }

async function fixture(suffix) {
  const supplied = externalFixtures?.['abc'.indexOf(suffix)];
  const username = supplied?.username ?? `${prefix}_${suffix}`;
  const email = supplied?.email ?? `${username}@void-integration.invalid`;
  const password = supplied?.password ?? `${randomBytes(18).toString('base64url')}Aa1!`;
  const id = supplied?.id ?? ok(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username } }), 'create temporary auth user').user.id;
  const client = createClient(url, key, options);
  const user = { id, username, email, originalPassword: password, client };
  users.push(user); // record before sign-in so cleanup also runs on failure
  const session = ok(await client.auth.signInWithPassword({ email, password }), 'sign in test account');
  assert.equal(session.user.id, id, 'Signed-in identity matches the configured test fixture'); checks += 1;
  await client.realtime.setAuth(session.session.access_token);
  user.originalProfile = ok(await client.from('profiles').select('username,bio').eq('id', id).single(), 'read original test profile');
  assert.equal(user.originalProfile.username, username, 'test fixture username matches its profile'); checks += 1;
  return user;
}

async function createRoom(owner, name, visibility) {
  const room = row(ok(await owner.client.rpc('create_room', { p_name: name, p_visibility: visibility }), `create ${visibility} room`));
  createdRooms.push({ id: room.id, owner, deleted: false });
  return room;
}

function subscription(channel, expectDenied = false) {
  channels.push(channel);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Realtime subscription timeout: ${channel.topic}`)), 25000);
    channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout);
        expectDenied ? reject(new Error('Unauthorized private channel subscription unexpectedly succeeded')) : resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timeout);
        const explicitDenial = status === 'CHANNEL_ERROR' && /permission|unauthori[sz]ed|forbidden|access.*denied|not.*allowed/i.test(error?.message ?? '');
        expectDenied && explicitDenial ? resolve() : reject(new Error(`Realtime subscription failed: ${status}: ${error?.message ?? ''}`));
      }
    });
  });
}

async function waitUntil(predicate, description) {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(description);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  checks += 1;
}

try {
  const a = await fixture('a');
  const b = await fixture('b');
  const c = await fixture('c');
  const aProfile = ok(await a.client.from('profiles').select('*').eq('id', a.id).single(), 'authenticated account has a profile');
  assert.equal(aProfile.username, a.username);
  assert.equal('email' in aProfile, false, 'profile never exposes email'); checks += 2;
  denied(await anonymous.from('profiles').select('*'), 'anonymous directory denied');
  denied(await anonymous.from('messages').select('*'), 'anonymous message history denied');
  denied(await anonymous.rpc('create_room', { p_name: `${prefix}-anon`, p_visibility: 'public' }), 'anonymous room mutation denied');

  const publicRoom = await createRoom(a, `${prefix}-public`, 'public');
  const privateRoom = await createRoom(a, `${prefix}-private`, 'private');
  assert.ok(publicRoom.id && privateRoom.id); checks += 1;
  empty(await b.client.from('rooms').select('*').eq('id', privateRoom.id), 'private room hidden from nonmember');
  empty(await b.client.from('room_members').select('*').eq('room_id', privateRoom.id), 'private membership hidden');
  denied(await b.client.rpc('join_room', { p_name: privateRoom.name }), 'private join without invitation denied');
  denied(await b.client.from('room_members').insert({ room_id: privateRoom.id, user_id: b.id }), 'direct membership escalation denied');
  denied(await b.client.rpc('invite_to_room', { p_room_id: privateRoom.id, p_username: c.username }), 'nonowner invitation denied');
  denied(await b.client.rpc('delete_room', { p_room_id: privateRoom.id }), 'nonowner delete denied');
  denied(await a.client.rpc('leave_room', { p_room_id: privateRoom.id }), 'owner cannot abandon room');

  ok(await b.client.rpc('join_room', { p_name: publicRoom.name }), 'join public room');
  ok(await a.client.rpc('invite_to_room', { p_room_id: privateRoom.id, p_username: b.username }), 'owner grants private access');
  ok(await b.client.rpc('join_room', { p_name: privateRoom.name }), 'invited member joins private room');

  const directory = ok(await b.client.rpc('room_directory', {}), 'member reads room directory');
  assert.ok(directory.some(room => room.id === publicRoom.id && room.joined && room.member_count >= 2 && room.owner_username === a.username), 'directory reports public room details'); checks += 1;
  assert.ok(directory.some(room => room.id === privateRoom.id && room.joined), 'directory reports invited private room to member'); checks += 1;
  const outsiderDirectory = ok(await c.client.rpc('room_directory', {}), 'nonmember reads room directory');
  assert.equal(outsiderDirectory.some(room => room.id === privateRoom.id), false, 'directory hides private room from nonmember'); checks += 1;
  const topicRoom = row(ok(await a.client.rpc('update_room_topic', { p_room_id: publicRoom.id, p_topic: 'a quieter group' }), 'owner updates room topic'));
  assert.equal(topicRoom.topic, 'a quieter group'); checks += 1;
  denied(await b.client.rpc('update_room_topic', { p_room_id: publicRoom.id, p_topic: 'takeover' }), 'nonowner topic change denied');

  // These go through the publishable client and real JWTs, never service_role.
  denied(await c.client.from('messages').insert({ room_id: publicRoom.id, sender_id: c.id, body: 'unauthorized' }), 'public room membership required to send');
  denied(await b.client.from('messages').insert({ room_id: privateRoom.id, sender_id: a.id, body: 'forged' }), 'sender impersonation denied');
  denied(await a.client.from('messages').insert({ room_id: privateRoom.id, sender_id: a.id, body: '   ' }), 'blank message rejected');
  denied(await a.client.from('messages').insert({ room_id: privateRoom.id, sender_id: a.id, body: 'x'.repeat(4001) }), 'oversize message rejected');
  denied(await a.client.from('messages').insert({ room_id: privateRoom.id, sender_id: a.id, body: 'forged timestamp', created_at: '2000-01-01T00:00:00Z' }), 'server timestamp cannot be forged');
  denied(await a.client.from('messages').insert({ sender_id: a.id, room_id: privateRoom.id, recipient_id: b.id, body: 'two targets' }), 'ambiguous destination rejected');
  denied(await a.client.from('messages').insert({ sender_id: a.id, recipient_id: a.id, body: 'self' }), 'self DM rejected');

  const secretMessage = ok(await a.client.from('messages').insert({ room_id: privateRoom.id, sender_id: a.id, body: `private ${prefix}` }).select().single(), 'persist private room message');
  assert.equal(ok(await b.client.from('messages').select('id').eq('id', secretMessage.id), 'invited member reads persisted message').length, 1); checks += 1;
  empty(await c.client.from('messages').select('*').eq('id', secretMessage.id), 'nonmember cannot read private message by known ID');
  denied(await b.client.from('messages').update({ body: 'edited' }).eq('id', secretMessage.id), 'message editing denied');
  denied(await b.client.from('profiles').update({ username: c.username }).eq('id', a.id), 'profile takeover denied');

  const dm = ok(await a.client.from('messages').insert({ recipient_id: b.id, sender_id: a.id, body: `dm ${prefix}` }).select().single(), 'persist direct message');
  assert.equal(ok(await b.client.from('messages').select('id').eq('id', dm.id), 'recipient reads DM').length, 1); checks += 1;
  empty(await c.client.from('messages').select('*').eq('id', dm.id), 'third user cannot read DM by ID');
  denied(await a.client.rpc('open_dm', { p_username: a.username }), 'open_dm self denied');
  assert.equal(row(ok(await a.client.rpc('open_dm', { p_username: b.username }), 'open DM resolves directory')).id, b.id); checks += 1;

  const updated = row(ok(await a.client.rpc('update_profile', { p_username: a.username, p_bio: 'integration test bio' }), 'profile update persists'));
  a.profileChanged = true;
  assert.equal(updated.bio, 'integration test bio'); checks += 1;
  denied(await a.client.rpc('update_profile', { p_username: b.username, p_bio: '' }), 'duplicate username denied');
  denied(await a.client.rpc('update_profile', { p_username: a.username, p_bio: 'x'.repeat(161) }), 'bio length enforced');
  denied(await a.client.rpc('create_room', { p_name: 'INVALID', p_visibility: 'public' }), 'invalid room name rejected');
  console.log('PASS: authentication, profiles, persisted room/DM messages, and SQL authorization checks.');

  // A real private subscription must receive a committed INSERT with RLS.
  let resolveMessage;
  const listener = b.client.channel(`room:${privateRoom.id}`, { config: { private: true, presence: { key: b.id }, postgres_changes_options: { wait: true, timeout: 15000 } } })
    .on('presence', { event: 'sync' }, () => {})
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${privateRoom.id}` }, (payload) => {
      if (payload.new.body === `realtime ${prefix}`) resolveMessage(payload);
    });
  await subscription(listener);
  const received = new Promise((resolve, reject) => {
    messageTimeout = setTimeout(() => reject(new Error('Committed private room message did not reach subscribed member')), 15000);
    resolveMessage = (payload) => { clearTimeout(messageTimeout); resolve(payload); };
  });
  // Attach the rejection observer before any network operation can fail.
  received.catch(() => {});
  ok(await a.client.from('messages').insert({ room_id: privateRoom.id, sender_id: a.id, body: `realtime ${prefix}` }), 'send live private room message');
  const event = await received;
  assert.equal(event.new.sender_id, a.id); checks += 1;
  console.log('PASS: persisted private-room INSERT delivered through real Realtime transport.');

  // Online presence and typing use the same real, private-channel Presence
  // transport as the terminal. Verify metadata reaches the other user.
  const roomPresence = a.client.channel(`room:${privateRoom.id}`, { config: { private: true, presence: { key: a.id } } })
    .on('presence', { event: 'sync' }, () => {});
  await subscription(roomPresence);
  assert.equal(await listener.track({ username: b.username, typing_at: 0 }), 'ok', 'member can publish room presence'); checks += 1;
  assert.equal(await roomPresence.track({ username: a.username, typing_at: 0 }), 'ok', 'owner can publish room presence'); checks += 1;
  await waitUntil(() => listener.presenceState()[a.id]?.some(meta => meta.username === a.username), 'Room presence did not reach another member');
  const typingAt = Date.now();
  assert.equal(await roomPresence.track({ username: a.username, typing_at: typingAt }), 'ok', 'typing update accepted'); checks += 1;
  await waitUntil(() => listener.presenceState()[a.id]?.some(meta => meta.typing_at === typingAt), 'Typing indicator did not reach another member');
  assert.equal(await roomPresence.untrack(), 'ok', 'room presence can be removed'); checks += 1;
  await waitUntil(() => !listener.presenceState()[a.id]?.length, 'Untracked member remained in room presence');

  const globalA = a.client.channel('presence:global', { config: { private: true, presence: { key: a.id } } }).on('presence', { event: 'sync' }, () => {});
  const globalB = b.client.channel('presence:global', { config: { private: true, presence: { key: b.id } } }).on('presence', { event: 'sync' }, () => {});
  await subscription(globalA);
  await subscription(globalB);
  assert.equal(await globalA.track({ username: a.username, online_at: new Date().toISOString() }), 'ok', 'global online presence accepted'); checks += 1;
  await waitUntil(() => globalB.presenceState()[a.id]?.some(meta => meta.username === a.username), 'Global online presence did not reach another authenticated user');

  const rogueRoom = c.client.channel(`room:${privateRoom.id}`, { config: { private: true } })
    .on('broadcast', { event: 'typing' }, () => {});
  await subscription(rogueRoom, true); checks += 1;
  const dmTopic = `dm:${[a.id, b.id].sort().join(':')}`;
  await subscription(c.client.channel(dmTopic, { config: { private: true } }).on('broadcast', { event: 'typing' }, () => {}), true); checks += 1;
  await subscription(b.client.channel(dmTopic, { config: { private: true } }).on('broadcast', { event: 'typing' }, () => {})); checks += 1;

  ok(await b.client.rpc('leave_room', { p_room_id: privateRoom.id }), 'leave private room');
  empty(await b.client.from('messages').select('*').eq('id', secretMessage.id), 'leaving immediately revokes persistent history');
  denied(await b.client.from('messages').insert({ room_id: privateRoom.id, sender_id: b.id, body: 'after leave' }), 'leaving immediately revokes sending');
  empty(await b.client.from('rooms').select('*').eq('id', privateRoom.id), 'leaving hides private room');

  // Serialize-safe limiter: concurrent sends cannot all pass the same count.
  const burst = await Promise.all(Array.from({ length: 12 }, (_, i) => c.client.from('messages').insert({ sender_id: c.id, recipient_id: a.id, body: `limit ${i}` })));
  assert.equal(burst.filter(result => !result.error).length, 10, 'exactly ten messages fit the fresh ten-second window'); checks += 1;
  assert.equal(burst.filter(result => result.error?.message.includes('rate limit')).length, 2, 'excess concurrent sends are rate-limited'); checks += 1;

  ok(await a.client.rpc('delete_room', { p_room_id: privateRoom.id }), 'owner deletes private room');
  createdRooms.find(room => room.id === privateRoom.id).deleted = true;
  empty(await a.client.from('messages').select('*').eq('id', secretMessage.id), 'room deletion cascades message history');

  // Recent login allows a real password change without a reauthentication nonce.
  // Restore the supplied credential before returning these external fixtures.
  const changedPassword = `${randomBytes(24).toString('base64url')}Aa1!`;
  c.passwordChanged = true;
  c.passwordRestoreClient = c.client;
  ok(await c.client.auth.updateUser({ password: changedPassword }), 'change test account password');
  const changedVerifier = createClient(url, key, options);
  verificationClients.push(changedVerifier);
  const changedSession = ok(await changedVerifier.auth.signInWithPassword({ email: c.email, password: changedPassword }), 'sign in with changed password');
  assert.equal(changedSession.user.id, c.id, 'changed password authenticates the same test account'); checks += 1;
  c.passwordRestoreClient = changedVerifier;
  ok(await changedVerifier.auth.updateUser({ password: c.originalPassword }), 'restore original test account password');
  c.passwordChanged = false;
  const originalVerifier = createClient(url, key, options);
  verificationClients.push(originalVerifier);
  const restoredSession = ok(await originalVerifier.auth.signInWithPassword({ email: c.email, password: c.originalPassword }), 'sign in with restored original password');
  assert.equal(restoredSession.user.id, c.id, 'original password restored to the same test account'); checks += 1;
  console.log(`PASS: ${checks} real database, authorization, concurrency, persistence, and Realtime assertions.`);
} finally {
  clearTimeout(messageTimeout);
  await Promise.allSettled(users.map(user => user.client.removeAllChannels()));
  for (const room of createdRooms.filter(room => !room.deleted)) {
    const result = await room.owner.client.rpc('delete_room', { p_room_id: room.id });
    if (result.error) {
      console.error(`Created test room cleanup failed: ${result.error.message}`);
      process.exitCode = 1;
    }
  }
  for (const user of users) {
    if (externalFixtures && user.profileChanged && user.originalProfile) {
      const result = await user.client.rpc('update_profile', { p_username: user.originalProfile.username, p_bio: user.originalProfile.bio });
      if (result.error) { console.error(`Test profile restoration failed: ${result.error.message}`); process.exitCode = 1; }
    }
    if (externalFixtures && user.passwordChanged) {
      const result = await user.passwordRestoreClient.auth.updateUser({ password: user.originalPassword });
      if (result.error && result.error.code !== 'same_password') {
        console.error(`Test password restoration failed: ${result.error.message}`);
        process.exitCode = 1;
      }
    }
    await user.client.auth.signOut({ scope: 'local' });
    if (admin) {
      const result = await admin.auth.admin.deleteUser(user.id);
      if (result.error) {
        console.error(`Test fixture cleanup failed: ${result.error.message}`);
        process.exitCode = 1;
      }
    }
  }
  await Promise.allSettled(verificationClients.map(async client => { await client.removeAllChannels(); await client.auth.signOut({ scope: 'local' }); }));
  await anonymous.removeAllChannels();
  await admin?.removeAllChannels();
  if (externalFixtures) console.log('External fixture accounts and append-only test DMs remain for their owner to clean up. No Auth account was deleted.');
}

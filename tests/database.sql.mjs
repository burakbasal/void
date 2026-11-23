/**
 * Runs the committed migration and authorization cases on embedded PostgreSQL.
 * auth.users, auth.uid(), realtime.topic(), and realtime.messages are a minimal
 * test harness, not a Supabase service. This verifies actual SQL/RLS behavior;
 * use database.integration.mjs to verify hosted Auth and Realtime transport.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema realtime;
  create table auth.users(id uuid primary key default gen_random_uuid(), raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'sub')::uuid $$;
  create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
  create table realtime.messages(id uuid default gen_random_uuid(), topic text, extension text, payload jsonb);
  alter table realtime.messages enable row level security;
  create publication supabase_realtime;
  grant usage on schema auth,realtime to authenticated;
  grant select,insert on realtime.messages to authenticated;
`);
const migration = await readFile(new URL('../supabase/migrations/20261117000000_void.sql', import.meta.url), 'utf8');
await db.exec(migration);
console.log('Migration executes on PostgreSQL successfully.');
const ids = ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];
for (let i = 0; i < ids.length; i++) await db.query('insert into auth.users(id,raw_user_meta_data) values ($1,$2)', [ids[i], JSON.stringify({username:`test_${i}`})]);
let checks = 0;
async function user(index, run) {
  await db.query(`select set_config('request.jwt.claims',$1,false)`,[JSON.stringify({sub:ids[index]})]);
  await db.exec('set role authenticated');
  try { return await run(); } finally { await db.exec('reset role'); }
}
async function deny(run) {
  await assert.rejects(run); checks++;
}
function check(condition, message) { assert.ok(condition,message); checks++; }
const room = await user(0, async () => (await db.query(`select * from public.create_room('private-room','private')`)).rows[0]);
const pub = await user(0, async () => (await db.query(`select * from public.create_room('public-room','public')`)).rows[0]);
await user(1, async () => {
  check((await db.query('select * from public.rooms where id=$1',[room.id])).rows.length === 0,'private rooms hidden');
  check((await db.query('select * from public.rooms where id=$1',[pub.id])).rows.length === 1,'public rooms discoverable');
  await deny(() => db.query(`select public.join_room('private-room')`));
  await deny(() => db.query('insert into public.room_members(room_id,user_id) values ($1,$2)',[room.id,ids[1]]));
  await deny(() => db.query('select public.delete_room($1)',[room.id]));
  await deny(() => db.query('select public.invite_to_room($1,$2)',[room.id,'test_2']));
  await deny(() => db.query('insert into public.messages(room_id,sender_id,body) values ($1,$2,$3)',[pub.id,ids[1],'nonmember']));
  await db.query('select public.join_room($1)',[pub.name]);
  check((await db.query('select * from public.room_members where room_id=$1 and user_id=$2',[pub.id,ids[1]])).rows.length === 1,'join creates membership');
});

// End-to-end group conversation at the data layer: both members exchange
// messages, while a non-member can discover the room but cannot read or write.
const groupMessages = {};
await user(0, async () => {
  groupMessages.owner = (await db.query('insert into public.messages(room_id,sender_id,body) values ($1,$2,$3) returning *',[pub.id,ids[0],'group hello from owner'])).rows[0];
});
await user(1, async () => {
  check((await db.query('select body from public.messages where id=$1',[groupMessages.owner.id])).rows[0].body === 'group hello from owner','member reads owner group message');
  groupMessages.member = (await db.query('insert into public.messages(room_id,sender_id,body) values ($1,$2,$3) returning *',[pub.id,ids[1],'group reply from member'])).rows[0];
  check((await db.query('select void_private.can_access_topic($1) as value',[`room:${pub.id}`])).rows[0].value === true,'joined public room topic allowed');
});
await user(0, async () => {
  check((await db.query('select body from public.messages where id=$1',[groupMessages.member.id])).rows[0].body === 'group reply from member','owner reads member group message');
  const history = await db.query('select body from public.messages where room_id=$1 order by created_at, id',[pub.id]);
  check(history.rows.length === 2 && history.rows[0].body === 'group hello from owner','group history ordered chronologically');
});
await user(2, async () => {
  check((await db.query('select * from public.rooms where id=$1',[pub.id])).rows.length === 1,'nonmember sees public room metadata');
  check((await db.query('select * from public.messages where id=$1',[groupMessages.owner.id])).rows.length === 0,'nonmember cannot read group messages');
  await deny(() => db.query('insert into public.messages(room_id,sender_id,body) values ($1,$2,$3)',[pub.id,ids[2],'nonmember write']));
});
await user(0, async () => {
  await db.query('select public.invite_to_room($1,$2)',[room.id,'test_1']);
  await deny(() => db.query('select public.leave_room($1)',[room.id]));
});
await user(1, async () => {
  await db.query('select public.join_room($1)',[room.name]);
  const directory = (await db.query('select * from public.room_directory()')).rows;
  check(directory.some(r => r.name === 'public-room' && r.member_count >= 2 && r.joined === true && r.owner_username === 'test_0'), 'directory reports public room membership and owner');
  check(directory.some(r => r.name === 'private-room' && r.joined === true), 'invited member sees private room in directory');
  await deny(() => db.query('select public.update_room_topic($1,$2)',[room.id,'hijacked']));
  await deny(() => db.query('select public.remove_from_room($1,$2)',[room.id,'test_0']));
});
await user(2, async () => {
  const directory = (await db.query('select * from public.room_directory()')).rows;
  check(!directory.some(r => r.name === 'private-room'), 'nonmember directory hides private room');
  check(directory.some(r => r.name === 'public-room' && r.joined === false && r.is_owner === false), 'nonmember sees public room as available');
});
await user(0, async () => {
  const updated = (await db.query('select (public.update_room_topic($1,$2)).topic as topic',[pub.id,'A quiet room'])).rows[0].topic;
  check(updated === 'A quiet room', 'owner changes room topic');
  await deny(() => db.query('select public.update_room_topic($1,$2)',[pub.id,'x'.repeat(121)]));
  await deny(() => db.query('select public.remove_from_room($1,$2)',[pub.id,'test_0']));
});
const kickRoom = await user(0, async () => {
  const created = (await db.query(`select * from public.create_room('kick-room','private','temporary group')`)).rows[0];
  check(created.topic === 'temporary group', 'room topic is stored at creation');
  await db.query('select public.invite_to_room($1,$2)',[created.id,'test_1']);
  return created;
});
await user(1, async () => {
  await db.query('select public.join_room($1)',[kickRoom.name]);
  check((await db.query('select * from public.rooms where id=$1',[kickRoom.id])).rows.length === 1,'invited member sees kick room');
});
await user(0, async () => {
  await db.query('select public.remove_from_room($1,$2)',[kickRoom.id,'test_1']);
  await deny(() => db.query('select public.remove_from_room($1,$2)',[kickRoom.id,'test_0']));
});
await user(1, async () => {
  check((await db.query('select * from public.rooms where id=$1',[kickRoom.id])).rows.length === 0,'kicked member loses room visibility');
  await deny(() => db.query('insert into public.messages(room_id,sender_id,body) values ($1,$2,$3)',[kickRoom.id,ids[1],'after kick']));
});
await user(0, async () => { await db.query('select public.delete_room($1)',[kickRoom.id]); });
let message;
await user(0, async () => {
  message = (await db.query('insert into public.messages(room_id,sender_id,body) values ($1,$2,$3) returning *',[room.id,ids[0],'private message'])).rows[0];
  await deny(() => db.query('insert into public.messages(room_id,sender_id,body,created_at) values ($1,$2,$3,now())',[room.id,ids[0],'timestamp']));
  await deny(() => db.query('insert into public.messages(room_id,sender_id,body) values ($1,$2,$3)',[room.id,ids[0],' '.repeat(3)]));
  await deny(() => db.query('insert into public.messages(room_id,sender_id,body) values ($1,$2,$3)',[room.id,ids[0],'x'.repeat(4001)]));
  await deny(() => db.query('insert into public.messages(recipient_id,sender_id,body) values ($1,$2,$3)',[ids[0],ids[0],'self dm']));
});
await user(1, async () => {
  check((await db.query('select * from public.messages where id=$1',[message.id])).rows.length === 1,'member can read');
  await deny(() => db.query('insert into public.messages(room_id,sender_id,body) values ($1,$2,$3)',[room.id,ids[0],'spoof']));
  await deny(() => db.query('update public.messages set body=$1 where id=$2',['edit',message.id]));
  check((await db.query('select void_private.can_access_topic($1) as value',[`room:${room.id}`])).rows[0].value === true,'member topic');
  await db.query('select public.leave_room($1)',[room.id]);
  check((await db.query('select * from public.messages where id=$1',[message.id])).rows.length === 0,'leave revokes history');
  check((await db.query('select void_private.can_access_topic($1) as value',[`room:${room.id}`])).rows[0].value === false,'leave revokes topic authorization');
});
const dm = await user(0, async () => (await db.query('insert into public.messages(recipient_id,sender_id,body) values ($1,$2,$3) returning *',[ids[1],ids[0],'dm'])).rows[0]);
await user(1, async () => {
  check((await db.query('select * from public.messages where id=$1',[dm.id])).rows.length === 1,'recipient reads DM');
  check((await db.query('select void_private.can_access_topic($1) as value',[`dm:${ids[0]}:${ids[1]}`])).rows[0].value === true,'DM participant topic');
});
await user(2, async () => {
  check((await db.query('select * from public.messages where id=$1',[dm.id])).rows.length === 0,'third user cannot read DM');
  check((await db.query('select void_private.can_access_topic($1) as value',[`dm:${ids[0]}:${ids[1]}`])).rows[0].value === false,'third user DM topic denied');
  check((await db.query('select void_private.can_access_topic($1) as value',[`room:${room.id}`])).rows[0].value === false,'nonmember room topic denied');
  check((await db.query('select void_private.can_access_topic($1) as value',['room:malformed'])).rows[0].value === false,'malformed topic denied');
  for (let i=0;i<10;i++) await db.query('insert into public.messages(recipient_id,sender_id,body) values ($1,$2,$3)',[ids[0],ids[2],`rate ${i}`]);
  await deny(() => db.query('insert into public.messages(recipient_id,sender_id,body) values ($1,$2,$3)',[ids[0],ids[2],'over limit']));
  for(let i=0;i<10;i++) await db.query(`select public.create_room($1,'public')`,[`test-limit-${i}`]);
  await deny(() => db.query(`select public.create_room('test-limit-11','public')`));
  await db.query(`select public.delete_room(id) from public.rooms where owner_id=$1`,[ids[2]]);
  await deny(() => db.query(`select public.create_room('test-limit-again','public')`));
});
await user(0, async () => {
  check((await db.query(`select (public.update_profile('test_0','updated bio')).bio as bio`)).rows[0].bio === 'updated bio','profile mutation works');
  await deny(() => db.query(`select public.update_profile('test_1','')`));
  await deny(() => db.query(`select public.update_profile('test_0',$1)`,['x'.repeat(161)]));
  await deny(() => db.query('update public.profiles set username=$1 where id=$2',['hijacked',ids[1]]));
  await db.query('select public.delete_room($1)',[room.id]);
  check((await db.query('select * from public.messages where id=$1',[message.id])).rows.length === 0,'delete cascades messages');
});
await db.exec('set role anon');
await deny(() => db.query('select * from public.profiles'));
await deny(() => db.query('select * from public.messages'));
await db.exec('reset role');
await db.close();
console.log(`PASS: ${checks} SQL/RLS assertions using real PostgreSQL in PGlite; auth and Realtime transport schemas stubbed, no hosted-service verification.`);

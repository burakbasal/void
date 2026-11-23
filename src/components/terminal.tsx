'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { RealtimeChannel, Session } from '@supabase/supabase-js';
import { api } from '@/lib/api';
import { getSupabase, isConfigured } from '@/lib/supabase';
import { COMMANDS, formatHelp, parseCommand, parseCreateArgs } from '@/lib/commands';
import { matchesConversation, roomDeletionForConversation, roomUpdateForConversation } from '@/lib/conversation';
import { formatRoomListing, formatRoomMember } from '@/lib/format';
import { emailSchema, usernameSchema, passwordSchema, readableError, TerminalError } from '@/lib/validation';
import { conversationTopic, type Conversation, type Message, type Profile, type Room } from '@/lib/types';

type Entry = { id: string; kind: 'system' | 'command' | 'error' | 'success' | 'message' | 'heading'; text: string; message?: Message };
type Flow = { mode: 'login' | 'register' | 'reset' | 'password'; step: 'email' | 'username' | 'password' | 'confirm'; email?: string; username?: string; password?: string };
const logo = `██╗   ██╗ ██████╗ ██╗██████╗
██║   ██║██╔═══██╗██║██╔══██╗
██║   ██║██║   ██║██║██║  ██║
╚██╗ ██╔╝██║   ██║██║██║  ██║
 ╚████╔╝ ╚██████╔╝██║██████╔╝
  ╚═══╝   ╚═════╝ ╚═╝╚═════╝`;
const sameConversation = (a: Conversation | null, b: Conversation | null) => a?.kind === b?.kind && (a?.kind === 'room' && b?.kind === 'room' ? a.room.id === b.room.id : a?.kind === 'dm' && b?.kind === 'dm' ? a.peer.id === b.peer.id : a === b);

export default function Terminal() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [flow, setFlow] = useState<Flow | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState('signed out');
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [typers, setTypers] = useState<Record<string, number>>({});
  const [intro, setIntro] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<Conversation | null>(null);
  const profileRef = useRef<Profile | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndex = useRef(-1);
  const seen = useRef(new Set<string>());
  const oldest = useRef<Message | null>(null);
  const busyRef = useRef(false);
  const authEpoch = useRef(0);
  const lastTyping = useRef(0);
  const wasNearBottom = useRef(true);
  const assertEpoch = (epoch: number) => {
    if (epoch !== authEpoch.current) throw new TerminalError('Your session changed. Run the command again.');
  };

  const write = useCallback((text: string, kind: Entry['kind'] = 'system') => {
    setEntries(prev => [...prev, { id: crypto.randomUUID(), text, kind }].slice(-600));
  }, []);
  const addMessages = useCallback((messages: Message[], prepend = false) => {
    setEntries(prev => {
      prev = messages.length ? prev.filter(e => e.text !== 'No messages yet. The next line is yours.') : prev;
      const known = new Set(prev.filter(e => e.message).map(e => e.id));
      const fresh = messages.filter(m => !known.has(m.id));
      const lines: Entry[] = fresh.map(m => ({ id: m.id, kind: 'message', text: m.body, message: m }));
      const firstMessage = prev.findIndex(e => e.kind === 'message');
      const position = firstMessage < 0 ? prev.length : firstMessage;
      const combined = prepend ? [...prev.slice(0, position), ...lines, ...prev.slice(position)] : [...prev, ...lines];
      const ordered = combined.filter(e => e.message).sort((a,b) => a.message!.created_at.localeCompare(b.message!.created_at) || a.id.localeCompare(b.id));
      let index = 0;
      const next = combined.map(e => e.message ? ordered[index++] : e);
      seen.current = new Set(next.filter(e => e.message).map(e => e.id));
      return next;
    });
  }, []);
  const setContext = useCallback((value: Conversation | null, options?: { preserveHistory?: boolean }) => {
    contextRef.current = value;
    setConversation(value);
    setTypers({});
    if (!options?.preserveHistory) oldest.current = null;
  }, []);

  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => {
    const handle = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault(); setEntries([]); setIntro(false);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  useEffect(() => {
    if (wasNearBottom.current) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [entries, flow, busy]);
  useEffect(() => { if (!busy) inputRef.current?.focus({ preventScroll: true }); }, [busy, flow, ready]);

  useEffect(() => {
    if (!isConfigured) { setConnection('backend not configured'); setReady(true); return; }
    const client = getSupabase();
    let alive = true;
    const { data: { subscription } } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!alive) return;
      const previousUserId = sessionRef.current?.user.id;
      const changedUser = !!previousUserId && !!nextSession && previousUserId !== nextSession.user.id;
      sessionRef.current = nextSession;
      setSession(nextSession);
      if (event === 'SIGNED_OUT' || changedUser) {
        authEpoch.current++;
        setProfile(null); profileRef.current = null; setContext(null);
        setConnection('signed out'); setOnline(new Set());
        setEntries([]); setIntro(true); seen.current.clear();
        historyRef.current = []; setFlow(null); setInput('');
      }
      if (event === 'PASSWORD_RECOVERY') { setFlow({ mode: 'password', step: 'password' }); write('Recovery verified. Choose a new password.'); }
      setReady(true);
    });
    void client.auth.getSession().then(({ error }) => { if (alive) { if (error) write(readableError(error), 'error'); setReady(true); } });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [setContext, write]);

  useEffect(() => {
    if (!session?.user.id) return;
    let alive = true;
    const epoch = authEpoch.current;
    void api.getProfile(session.user.id).then(p => {
      if (!alive || epoch !== authEpoch.current) return;
      if (!p) throw new TerminalError('Your account profile is missing. Apply the included database migrations, then sign in again.');
      setProfile(p); profileRef.current = p;
      setIntro(false);
      write(`Session opened. Welcome, @${p.username}.`, 'success');
      write('Find your people with /users, or find a space with /rooms. /help lists every command.');
    }).catch(error => { if (alive && epoch === authEpoch.current) write(`${readableError(error)} Use /logout and sign in again after checking migrations.`, 'error'); });
    return () => { alive = false; };
  }, [session?.user.id, write]);

  useEffect(() => {
    if (!session?.user.id || !profile) return;
    const client = getSupabase(), userId = session.user.id;
    setConnection('connecting');
    let alive = true;
    const epoch = authEpoch.current;
    const active = () => alive && epoch === authEpoch.current;
    const globalChannel = client.channel('presence:global', { config: { private: true, presence: { key: userId }, postgres_changes_options: { wait: true, timeout: 15000 } } });
    const syncHistory = async () => {
      const c = contextRef.current;
      if (!c) return;
      try {
        if (c.kind === 'room') {
          const joined = await api.listJoinedRooms(userId);
          if (!active() || !sameConversation(c, contextRef.current)) return;
          if (!joined.some(r => r.id === c.room.id)) {
            setContext(null); setEntries([]); seen.current.clear();
            write('This room is no longer available. You have returned to the lobby.', 'error'); return;
          }
        }
        const data = await api.getMessages(c);
        if (active() && sameConversation(c, contextRef.current)) {
          setEntries(prev => prev.filter(e => e.kind !== 'message'));
          seen.current.clear(); oldest.current = data[0] ?? null;
          addMessages(data);
        }
      }
      catch (error) { if (active()) write(readableError(error), 'error'); }
    };
    globalChannel.on('presence', { event: 'sync' }, () => {
      if (active()) setOnline(new Set(Object.keys(globalChannel.presenceState())));
    }).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      void (async () => {
        const m = payload.new as Message;
        if (!active() || seen.current.has(m.id)) return;
        if (matchesConversation(m, contextRef.current, userId)) {
          try { m.sender = (await api.getProfile(m.sender_id)) ?? undefined; } catch { /* UUID remains a truthful fallback. */ }
          if (active() && matchesConversation(m, contextRef.current, userId)) addMessages([m]);
        } else if (m.recipient_id === userId) {
          let sender = m.sender_id;
          try { sender = (await api.getProfile(m.sender_id))?.username ?? m.sender_id; } catch { /* Keep original identifier. */ }
          if (active()) write(`↳ New DM from @${sender}. Open it with /dm ${sender}.`, 'success');
        }
      })();
    }).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms' }, payload => {
      if (!active()) return;
      const updated = payload.new as Room;
      if (!updated || typeof updated.id !== 'string') return;
      const current = contextRef.current;
      const room = roomUpdateForConversation(current, updated);
      if (!room) return;
      setContext({ kind: 'room', room }, { preserveHistory: true });
      if (current?.kind === 'room' && current.room.topic !== room.topic) {
        write(room.topic ? `Topic in #${room.name} changed to: ${room.topic}` : `Topic in #${room.name} was cleared.`);
      }
    }).on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'rooms' }, payload => {
      if (!active() || !roomDeletionForConversation(contextRef.current, (payload.old as { id?: unknown })?.id)) return;
      setContext(null); setEntries([]); seen.current.clear();
      write('This room was deleted. You have returned to the lobby.', 'error');
    });
    void client.realtime.setAuth().then(() => {
      if (!active()) return;
      globalChannel.subscribe(status => {
        if (!active()) return;
        setConnection(status === 'SUBSCRIBED' ? 'live' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'reconnecting' : 'connecting');
        if (status === 'SUBSCRIBED') { void globalChannel.track({ username: profile.username, online_at: new Date().toISOString() }); void syncHistory(); }
      });
    }).catch(error => { if (active()) { setConnection('connection failed'); write(readableError(error), 'error'); } });
    const reconnect = () => { void syncHistory(); };
    window.addEventListener('online', reconnect);
    const focus = () => { if (document.visibilityState === 'visible') void syncHistory(); };
    document.addEventListener('visibilitychange', focus);
    const offline = () => setConnection('offline');
    window.addEventListener('offline', offline);
    return () => { alive = false; window.removeEventListener('online', reconnect); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', focus); void client.removeChannel(globalChannel); };
  }, [session?.user.id, profile?.username, addMessages, write, setContext]);

  useEffect(() => {
    if (!conversation || !session?.user.id || !profile) return;
    const client = getSupabase(), userId = session.user.id;
    const topic = conversationTopic(conversation, userId);
    let alive = true;
    const channel = client.channel(topic, { config: { private: true, presence: { key: userId } } });
    channelRef.current = channel;
    channel.on('presence', { event: 'sync' }, () => {
      if (!alive) return;
      const state = channel.presenceState<{ typing_at?: number }>();
      const times: Record<string, number> = {};
      for (const [id, values] of Object.entries(state)) if (id !== userId) times[id] = Math.max(...values.map(v => v.typing_at ?? 0));
      setTypers(times);
    }).subscribe(status => {
      if (alive && status === 'SUBSCRIBED') void channel.track({ typing_at: 0 });
      if (alive && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) write('Conversation presence unavailable. Saved messages are still protected by database permissions.', 'error');
    });
    return () => { alive = false; channelRef.current = null; void client.removeChannel(channel); };
  }, [conversation, session?.user.id, profile?.id, write]);
  const [tick, setTick] = useState(0);
  useEffect(() => { const timer = setInterval(() => setTick(n => n + 1), 2000); return () => clearInterval(timer); }, []);
  const typingCount = Object.values(typers).filter(t => t > Date.now() - 4500).length;
  void tick;

  const open = async (c: Conversation) => {
    const epoch = authEpoch.current;
    setContext(c); seen.current.clear(); setEntries([]); setIntro(false);
    const label = c.kind === 'room' ? `#${c.room.name}` : `@${c.peer.username}`;
    write(`${label} / ${c.kind === 'room' ? c.room.visibility + ' room' : 'direct conversation'}`, 'heading');
    const data = await api.getMessages(c);
    assertEpoch(epoch);
    if (!sameConversation(c, contextRef.current)) return;
    addMessages(data); oldest.current = data[0] ?? null;
    if (!data.length) write('No messages yet. The next line is yours.');
  };
  const send = async (body: string, c = contextRef.current) => {
    const epoch = authEpoch.current;
    if (!c || !sessionRef.current) throw new TerminalError('Enter a room with /join or open a conversation with /dm first.');
    const m = await api.sendMessage(c, sessionRef.current.user.id, body);
    assertEpoch(epoch);
    if (sameConversation(c, contextRef.current)) { m.sender = profileRef.current ?? undefined; addMessages([m]); if (!oldest.current) oldest.current = m; }
  };
  const requireBackend = () => { if (!isConfigured) throw new TerminalError('Supabase is not configured. Add the project URL and public key to .env.local, apply the migration, then restart VOID.'); };
  const runFlow = async (value: string) => {
    if (!flow) return;
    const epoch = authEpoch.current;
    requireBackend();
    const client = getSupabase();
    if (flow.step === 'email') {
      const email = emailSchema.parse(value.trim());
      if (flow.mode === 'reset') {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        assertEpoch(epoch);
        if (error) throw error;
        setFlow(null); write('If that email belongs to an account, a recovery link is on its way.'); return;
      }
      setFlow({ ...flow, email, step: flow.mode === 'register' ? 'username' : 'password' });
      write(flow.mode === 'register' ? 'Choose your username. 3–24 characters: letters, numbers, underscores.' : 'Enter your password. Input is hidden.');
    } else if (flow.step === 'username') {
      const username = usernameSchema.parse(value.trim().toLowerCase());
      setFlow({ ...flow, username, step: 'password' });
      write('Choose a password. 12–128 characters; passphrases are welcome. Input is hidden.');
    } else if (flow.step === 'password') {
      if (flow.mode === 'login') {
        const { error } = await client.auth.signInWithPassword({ email: flow.email!, password: value });
        assertEpoch(epoch);
        if (error) { setFlow({ ...flow, step: 'password' }); throw error; }
        setFlow(null);
      } else {
        passwordSchema.parse(value);
        setFlow({ ...flow, password: value, step: 'confirm' }); write('Confirm your password. Input is hidden.');
      }
    } else {
      if (value !== flow.password) throw new TerminalError('Passwords do not match. Re-enter the confirmation, or /cancel to start again.');
      if (flow.mode === 'password') {
        const { error } = await client.auth.updateUser({ password: value });
        assertEpoch(epoch);
        if (error) throw error;
        setFlow(null); write('Your password has been updated.', 'success');
      } else {
        const { data, error } = await client.auth.signUp({ email: flow.email!, password: value, options: { data: { username: flow.username }, emailRedirectTo: window.location.origin } });
        assertEpoch(epoch);
        if (error) { setFlow({ mode: 'register', step: 'email' }); throw error; }
        setFlow(null);
        write(data.session ? 'Account created.' : 'Check your email to confirm your account, then return and type login. /resend sends another confirmation.', 'success');
      }
    }
  };

  const execute = async (raw: string) => {
    const epoch = authEpoch.current;
    const checkpoint = () => assertEpoch(epoch);
    const text = raw.trim();
    if (text === '/cancel') { setFlow(null); write('Cancelled.'); return; }
    if (flow) { await runFlow(raw); return; }
    if (['login', '/login', 'register', '/register'].includes(text.toLowerCase())) {
      if (sessionRef.current) throw new TerminalError('You are already signed in. Use /logout to switch accounts.');
      requireBackend();
      const mode = text.toLowerCase().includes('register') ? 'register' : 'login';
      setFlow({ mode, step: 'email' }); write(mode === 'register' ? 'Let’s make a little space for you. Enter your email.' : 'Welcome back. Enter your email.'); return;
    }
    const command = parseCommand(text);
    if (command?.name === '/clear') { setEntries([]); setIntro(false); return; }
    if (command?.name === '/help') {
      write('COMMAND REFERENCE', 'heading');
      write(sessionRef.current ? 'All commands are available in this session.' : 'Rooms and messages require login or register.');
      formatHelp().forEach(line => write(line));
      return;
    }
    requireBackend();
    if (command?.name === '/reset') { setFlow({ mode: 'reset', step: 'email' }); write('Enter your account email for a recovery link.'); return; }
    if (command?.name === '/resend') {
      const email = emailSchema.parse(command.args[0] ?? '');
      const { error } = await getSupabase().auth.resend({ type: 'signup', email, options: { emailRedirectTo: window.location.origin } });
      checkpoint();
      if (error) throw error; write('If confirmation is pending, a new link is on its way.'); return;
    }
    if (!sessionRef.current) throw new TerminalError('Start with login or register. /help is always here.');
    const me = profileRef.current;
    if (command?.name === '/logout') {
      const { error } = await getSupabase().auth.signOut({ scope: 'local' });
      if (error) throw error; return;
    }
    if (!me) throw new TerminalError('Your profile is still loading. Try again in a moment.');
    if (!command) { await send(raw.startsWith('//') ? raw.slice(1) : raw); return; }
    const { name, args } = command;
    const c = contextRef.current;
    switch (name) {
      case '/rooms': {
        const rooms = await api.listRoomDirectory();
        checkpoint();
        write('ROOM DIRECTORY', 'heading');
        if (!rooms.length) write('No rooms yet. Create the first with /create <name> public "a topic".');
        rooms.forEach(room => write(formatRoomListing(room)));
        write('● joined   · available     /join <name> to enter'); break;
      }
      case '/create': {
        const input = parseCreateArgs(args);
        const room = await api.createRoom(input.name, input.visibility, input.topic);
        checkpoint(); await open({ kind: 'room', room }); break;
      }
      case '/join': {
        if (args.length !== 1) throw new TerminalError('Usage: /join <name>');
        const room = await api.joinRoom(args[0].replace(/^#/, ''));
        checkpoint(); await open({ kind: 'room', room }); break;
      }
      case '/members': {
        if (c?.kind !== 'room') throw new TerminalError('Enter a room first.');
        const members = await api.listRoomMembers(c.room.id);
        checkpoint();
        write(`MEMBERS / #${c.room.name}`, 'heading');
        members.forEach(member => write(formatRoomMember(member, c.room.owner_id, online, me.id)));
        write(`${members.length} ${members.length === 1 ? 'person' : 'people'} in this room.`); break;
      }
      case '/topic': {
        if (c?.kind !== 'room') throw new TerminalError('Enter a room first.');
        if (!args.length) { write(c.room.topic ? `Topic: ${c.room.topic}` : 'This room has no topic. The owner can set one with /topic <text>.'); break; }
        const updated = await api.updateRoomTopic(c.room.id, args.join(' '));
        checkpoint();
        setContext({ kind: 'room', room: updated }, { preserveHistory: true });
        write(updated.topic ? `Topic set: ${updated.topic}` : 'Topic cleared.', 'success'); break;
      }
      case '/users': {
        const users = await api.searchUsers(args[0]?.replace(/^@/, '') ?? '');
        checkpoint();
        write('PEOPLE', 'heading');
        if (!users.length) write('No matching usernames.');
        users.forEach(p => write(`${online.has(p.id) ? '●' : '·'} @${p.username.padEnd(24)} ${p.bio || ''}${p.id === me.id ? ' (you)' : ''}`));
        write('● online here    /dm <username> to connect'); break;
      }
      case '/dm': {
        if (!args[0]) throw new TerminalError('Usage: /dm <username> [message]');
        const peer = await api.openDm(args[0].replace(/^@/, ''));
        checkpoint();
        await open({ kind: 'dm', peer });
        checkpoint();
        if (args.length > 1) await send(args.slice(1).join(' '), { kind: 'dm', peer }); break;
      }
      case '/inbox': {
        const { data, error } = await getSupabase().from('messages').select('sender_id,recipient_id,created_at').is('room_id', null).or(`sender_id.eq.${me.id},recipient_id.eq.${me.id}`).order('created_at', { ascending: false }).limit(200);
        checkpoint();
        if (error) throw error;
        const ids = [...new Set((data ?? []).map(m => m.sender_id === me.id ? m.recipient_id : m.sender_id))] as string[];
        write('RECENT DIRECT CONVERSATIONS', 'heading');
        if (!ids.length) write('No direct conversations yet. /users helps you find someone.');
        for (const id of ids) { const p = await api.getProfile(id); checkpoint(); if (p) write(`@${p.username}    /dm ${p.username}`); } break;
      }
      case '/profile': {
        if (args[0] === 'bio') {
          if (args.length < 2) throw new TerminalError('Usage: /profile bio <text>. Use /profile bio "" to clear it.');
          const p = await api.updateProfile(me.username, args.slice(1).join(' ')); checkpoint(); setProfile(p); profileRef.current = p; write('Bio updated.', 'success');
        } else if (args[0] === 'username') {
          if (args.length !== 2) throw new TerminalError('Usage: /profile username <new-name>');
          const p = await api.updateProfile(args[1], me.bio); checkpoint(); setProfile(p); profileRef.current = p; write(`You are now @${p.username}.`, 'success');
        } else {
          const requested = args[0]?.replace(/^@/, '').toLowerCase();
          const p = requested && requested !== me.username ? await api.openDm(requested) : me;
          checkpoint();
          write(`@${p.username}`, 'heading'); write(p.bio || 'No bio set.'); write(`Joined ${new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`);
          if (p.id === me.id) write('/profile bio <text> · /profile username <name>');
        } break;
      }
      case '/invite': {
        if (c?.kind !== 'room') throw new TerminalError('Enter a room first.');
        if (args.length !== 1) throw new TerminalError('Usage: /invite <username>');
        const username = args[0].replace(/^@/, '');
        await api.inviteToRoom(c.room.id, username); checkpoint(); write(`@${username} can now /join ${c.room.name}.`, 'success'); break;
      }
      case '/kick': {
        if (c?.kind !== 'room') throw new TerminalError('Enter a room first.');
        if (args.length !== 1) throw new TerminalError('Usage: /kick <username>');
        const username = args[0].replace(/^@/, '');
        await api.removeFromRoom(c.room.id, username); checkpoint(); write(`@${username} was removed from #${c.room.name}.`, 'success'); break;
      }
      case '/leave': {
        if (!c) throw new TerminalError('You are already in the lobby.');
        if (c.kind === 'room') await api.leaveRoom(c.room.id);
        checkpoint();
        setContext(null); setEntries([]); setIntro(false); write('Returned to the lobby. /rooms or /users to continue.'); break;
      }
      case '/delete': {
        if (c?.kind !== 'room') throw new TerminalError('Enter the room you own first.');
        if (args[0] !== c.room.name || args.length !== 1) throw new TerminalError(`This permanently deletes the room and its messages. Type /delete ${c.room.name} to confirm.`);
        await api.deleteRoom(c.room.id); checkpoint(); setContext(null); setEntries([]); write('Room and its messages deleted.', 'success'); break;
      }
      case '/history': {
        if (!c) throw new TerminalError('Open a room or DM first.');
        if (!oldest.current) { write('You are at the beginning.'); break; }
        const data = await api.getMessages(c, { id: oldest.current.id, created_at: oldest.current.created_at });
        checkpoint();
        if (!data.length) write('You are at the beginning.');
        else { addMessages(data, true); oldest.current = data[0]; write(`${data.length} earlier messages loaded above.`); } break;
      }
      case '/password': setFlow({ mode: 'password', step: 'password' }); write('Choose your new password. Input is hidden.'); break;
      default: throw new TerminalError(`Unknown command: ${name}. Type /help, or press Tab to complete a command. Use // to send a message beginning with /. `);
    }
  };
  const submit = async () => {
    if (!input.trim() || busyRef.current || !ready) return;
    const raw = input;
    setInput(''); busyRef.current = true; setBusy(true); wasNearBottom.current = true;
    const epoch = authEpoch.current;
    if (!flow) {
      if (!sessionRef.current || raw.startsWith('/')) write(raw, 'command');
      if (sessionRef.current && raw.startsWith('/') && !raw.startsWith('/dm ')) { historyRef.current = [raw, ...historyRef.current.filter(x => x !== raw)].slice(0, 80); }
    }
    historyIndex.current = -1;
    if (channelRef.current) void channelRef.current.track({ typing_at: 0 });
    try { await execute(raw); }
    catch (error) { if (epoch === authEpoch.current) { write(readableError(error), 'error'); if (!flow && !raw.startsWith('/')) setInput(raw); } }
    finally { busyRef.current = false; setBusy(false); }
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
    else if (event.key === 'Escape') { setInput(''); setFlow(null); if (flow) write('Cancelled.'); }
    else if (event.key === 'Tab' && !flow && input.startsWith('/')) {
      const options = COMMANDS.filter(c => c.startsWith(input.split(' ')[0]));
      if (options.length) { event.preventDefault(); if (options.length === 1) setInput(options[0] + ' '); else write(options.join('   ')); }
    } else if (event.key === 'ArrowUp' && !flow) {
      event.preventDefault(); historyIndex.current = Math.min(historyIndex.current + 1, historyRef.current.length - 1); setInput(historyRef.current[historyIndex.current] ?? '');
    } else if (event.key === 'ArrowDown' && !flow) {
      event.preventDefault(); historyIndex.current = Math.max(-1, historyIndex.current - 1); setInput(historyRef.current[historyIndex.current] ?? '');
    }
  };
  const secret = flow?.step === 'password' || flow?.step === 'confirm';
  const prompt = flow ? flow.step === 'confirm' ? 'confirm' : flow.step : conversation?.kind === 'room' ? `#${conversation.room.name}` : conversation?.kind === 'dm' ? `@${conversation.peer.username}` : profile ? `@${profile.username}` : '~';
  return (
    <main className="terminal-shell" onClick={event => { if (!(event.target as HTMLElement).closest('a,input') && !window.getSelection()?.toString()) inputRef.current?.focus({ preventScroll: true }); }}>
      <header className="terminal-header">
        <div className="brand"><span className="terminal-mark" aria-hidden="true">›_</span><span>VOID</span><span className="header-divider">/</span><span className="brand-caption">a quieter connection</span></div>
        <div className="header-status"><span className={connection === 'live' ? 'status-dot live' : 'status-dot'} />{session ? `@${profile?.username ?? 'connecting'}` : 'guest session'}<span className="header-divider">/</span><span className="status-label">{connection}</span></div>
      </header>
      <div className="terminal-body" ref={streamRef} onScroll={event => { const el = event.currentTarget; wasNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
        <div className="transcript">
          {intro && <section className="intro" aria-label="Welcome to VOID">
            <div className="protocol-label"><span className="tiny-cross">+</span> EST. 2026 <span className="protocol-rule" /> TERMINAL / 01</div>
            <pre className="ascii-logo" aria-label="VOID">{logo}</pre>
            <p className="manifesto">Less noise.<br /><span>More signal.</span></p>
            <div className="intro-copy"><p>No feeds. No distractions.</p><p>Just people, words, and a little space.</p></div>
            <div className="welcome-line"><span className="line-marker">↳</span><p>Welcome. Login or register?<span className="welcome-cursor" aria-hidden="true" /></p></div>
            <p className="intro-hint">Type <span>login</span> or <span>register</span> to begin. <span>/help</span> if you need a hand.</p>
          </section>}
          <div role="log" aria-live="polite" aria-relevant="additions" className="entries" aria-label="Terminal output">
            {entries.map(entry => entry.kind === 'message' && entry.message ? <div className="message-line entry" key={entry.id}>
              <time dateTime={entry.message.created_at}>{new Date(entry.message.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time>
              <span className={entry.message.sender_id === session?.user.id ? 'message-author own' : 'message-author'}>@{entry.message.sender?.username ?? entry.message.sender_id.slice(0, 8)}</span>
              <span className="message-body">{entry.text}</span>
            </div> : <div className={`entry entry-${entry.kind}`} key={entry.id}><span className="entry-marker" aria-hidden="true">{entry.kind === 'command' ? '›' : entry.kind === 'error' ? '!' : entry.kind === 'success' ? '✓' : entry.kind === 'heading' ? '—' : '·'}</span><span>{entry.text}</span></div>)}
          </div>
          <div className="activity-line" aria-live="polite">{busy ? 'working' : typingCount ? `${typingCount === 1 ? 'Someone is' : `${typingCount} people are`} typing` : ''}{(busy || typingCount > 0) && <span className="ellipsis">...</span>}</div>
          <div ref={endRef} />
        </div>
      </div>
      <div className="command-area">
        {flow && <div className="flow-label">{flow.mode} / {flow.step}<span>esc to cancel</span></div>}
        <div className={`command-line ${busy ? 'is-busy' : ''}`}>
          <label className="prompt" htmlFor="terminal-input"><span>{prompt}</span><span className="prompt-arrow">›</span></label>
          <div className="input-track"><input id="terminal-input" ref={inputRef} aria-label={flow ? `Enter ${flow.step}` : 'Terminal command'} type={secret ? 'password' : 'text'} value={input} onChange={event => {
            setInput(event.target.value);
            if (!flow && contextRef.current && channelRef.current && Date.now() - lastTyping.current > 1500) { lastTyping.current = Date.now(); void channelRef.current.track({ typing_at: event.target.value ? Date.now() : 0 }); }
          }} onKeyDown={onKey} disabled={busy || !ready} maxLength={secret ? 128 : 4000} autoFocus autoComplete="off" autoCapitalize="off" spellCheck={false} inputMode={flow?.step === 'email' ? 'email' : 'text'} data-1p-ignore data-lpignore="true" /><span className="empty-cursor" aria-hidden="true" style={{ opacity: input || busy ? 0 : undefined }} /></div>
          <span className="enter-hint" aria-hidden="true">{busy ? '···' : 'return ↵'}</span>
        </div>
        <footer className="terminal-footer"><span><span className="footer-command">/help</span> command reference</span><span className="keyboard-hints">tab complete<span>↑↓ history</span>ctrl+l clear</span><span className="footer-signature">a little space, for you.</span></footer>
      </div>
    </main>
  );
}

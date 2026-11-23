import { TerminalError } from './validation';

export const COMMANDS = ['login','register','/help','/rooms','/create','/join','/members','/topic','/dm','/profile','/clear','/logout','/users','/invite','/kick','/leave','/delete','/history','/cancel','/inbox','/resend','/reset','/password'];

/** Every command the terminal accepts, including account commands used before login. */
export const HELP_ENTRIES = [
  ['login', 'open your session'],
  ['register', 'create an account'],
  ['/reset', 'recover your password'],
  ['/password', 'set a new password after opening a recovery link'],
  ['/resend <email>', 'resend account confirmation'],
  ['/rooms', 'discover rooms with topics and member counts'],
  ['/create <name> [public|private] ["topic"]', 'create a room and enter it · public by default; topic may follow the name directly'],
  ['/join <name>', 'enter a public room or an invited private room'],
  ['/members', 'list everyone in the current room'],
  ['/topic [text]', 'show or change the room topic · use "" to clear · owner only'],
  ['/users [prefix]', 'find people · see who is online'],
  ['/dm <username> [message]', 'open a private conversation'],
  ['/inbox', 'list your recent direct conversations'],
  ['/profile [username]', 'read your profile or someone else’s'],
  ['/profile bio <text>', 'update your bio · use "" to clear it'],
  ['/profile username <name>', 'change your username'],
  ['/invite <username>', 'invite someone to your current room · owner only'],
  ['/kick <username>', 'remove someone from your room · owner only'],
  ['/leave', 'leave the current room or DM'],
  ['/delete <room-name>', 'permanently delete your current room · owner only'],
  ['/history', 'load 50 earlier messages'],
  ['/cancel', 'cancel the current prompt'],
  ['/clear', 'clear this terminal · messages remain saved'],
  ['/logout', 'close your session'],
  ['/help', 'you are here'],
] as const;

export function formatHelp(): string[] {
  return HELP_ENTRIES.map(([command, detail]) => `${command}\n  ${detail}`);
}

export type CreateRoomArgs = { name: string; visibility: "public" | "private"; topic: string };

/** Accepts `/create name`, `/create name public "topic"`, and `/create name "topic"`. */
export function parseCreateArgs(args: string[]): CreateRoomArgs {
  const [rawName, second, third, ...extra] = args;
  const usage = 'Usage: /create <name> [public|private] ["topic"]';
  if (!rawName || extra.length) throw new TerminalError(usage);
  const name = rawName.replace(/^#/, "");
  if (second === undefined) return { name, visibility: "public", topic: "" };
  if (second === "public" || second === "private") {
    if (third === undefined) return { name, visibility: second, topic: "" };
    return { name, visibility: second, topic: third };
  }
  if (third !== undefined) throw new TerminalError(usage);
  return { name, visibility: "public", topic: second };
}

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let token = '', quote = '', escaped = false, started = false;
  for (const ch of input) {
    if (escaped) { token += ch; escaped = false; started = true; }
    else if (ch === '\\') { escaped = true; started = true; }
    else if (quote) { if (ch === quote) quote = ''; else token += ch; }
    else if (ch === '"' || ch === "'") { quote = ch; started = true; }
    else if (/\s/.test(ch)) { if (started) { tokens.push(token); token = ''; started = false; } }
    else { token += ch; started = true; }
  }
  if (escaped) throw new TerminalError('Finish the escaped character or remove the trailing backslash.');
  if (quote) throw new TerminalError('Close the quotation mark and try again.');
  if (started) tokens.push(token);
  return tokens;
}
export function parseCommand(input: string): { name: string; args: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  const [name, ...args] = tokenize(trimmed);
  return { name: name.toLowerCase(), args };
}

import { TerminalError } from './validation';

export const COMMANDS = ['/help','/rooms','/create','/join','/members','/topic','/dm','/profile','/clear','/logout','/users','/invite','/kick','/leave','/delete','/history','/cancel','/inbox','/resend','/reset','/password'];
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

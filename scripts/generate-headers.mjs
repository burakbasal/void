/**
 * Builds a strict, hash-based CSP for the static export.
 * Next.js static output contains a handful of inline bootstrap scripts; their
 * SHA-256 hashes are injected into the Cloudflare Pages `_headers` file so no
 * 'unsafe-inline' permission is needed. The Supabase connect sources are
 * narrowed to the configured backend instead of allowing every *.supabase.co
 * host and every local port in production.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = path.resolve('out');
const templatePath = path.resolve('config/_headers.template');
const envPath = path.resolve('.env.local');

function stripQuotes(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function envValue(name) {
  if (process.env[name]?.trim()) return process.env[name].trim();
  try {
    const env = await readFile(envPath, 'utf8');
    for (const line of env.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match?.[1] === name) return stripQuotes(match[2]);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return '';
}

/** Returns only the origins the browser client can legitimately contact. */
export function connectSourcesForSupabase(rawUrl) {
  const localSources = [
    'http://127.0.0.1:*',
    'ws://127.0.0.1:*',
    'http://localhost:*',
    'ws://localhost:*',
  ];
  const urlValue = rawUrl?.trim();
  if (!urlValue) return localSources;

  let url;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must be an absolute URL.');
  }

  const isLocalHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must use https, except for a local http Supabase instance.');
  }

  const websocketProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return [url.origin, `${websocketProtocol}//${url.host}`];
}

export function buildCsp(hashes, rawSupabaseUrl) {
  const connectSources = connectSourcesForSupabase(rawSupabaseUrl);
  return [
    "default-src 'self'",
    `script-src 'self' ${[...hashes].join(' ')}`.trim(),
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${connectSources.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

async function htmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(full));
    else if (entry.name.endsWith('.html')) files.push(full);
  }
  return files;
}

async function main() {
  const hashes = new Set();
  for (const file of await htmlFiles(outDir)) {
    const html = await readFile(file, 'utf8');
    for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      const code = match[1];
      if (!code.trim()) continue;
      hashes.add(`'sha256-${createHash('sha256').update(code).digest('base64')}'`);
    }
  }

  const supabaseUrl = await envValue('NEXT_PUBLIC_SUPABASE_URL');
  const csp = buildCsp(hashes, supabaseUrl);
  const template = await readFile(templatePath, 'utf8');
  await writeFile(path.join(outDir, '_headers'), template.replace('__CSP__', csp));
  console.log(`Generated out/_headers with ${hashes.size} inline-script hashes and no 'unsafe-inline'.`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) await main();

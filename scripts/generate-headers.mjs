/**
 * Builds a strict, hash-based CSP for the static export.
 * Next.js static output contains a handful of inline bootstrap scripts; their
 * SHA-256 hashes are injected into the Cloudflare Pages `_headers` file so no
 * 'unsafe-inline' permission is needed.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outDir = path.resolve('out');
const templatePath = path.resolve('config/_headers.template');

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

const hashes = new Set();
for (const file of await htmlFiles(outDir)) {
  const html = await readFile(file, 'utf8');
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const code = match[1];
    if (!code.trim()) continue;
    hashes.add(`'sha256-${createHash('sha256').update(code).digest('base64')}'`);
  }
}

const csp = [
  "default-src 'self'",
  `script-src 'self' ${[...hashes].join(' ')}`.trim(),
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const template = await readFile(templatePath, 'utf8');
await writeFile(path.join(outDir, '_headers'), template.replace('__CSP__', csp));
console.log(`Generated out/_headers with ${hashes.size} inline-script hashes and no 'unsafe-inline'.`);

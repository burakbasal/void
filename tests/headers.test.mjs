import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCsp, connectSourcesForSupabase } from '../scripts/generate-headers.mjs';

describe('static export header hardening', () => {
  it('limits the hosted backend to its exact HTTP and WebSocket origins', () => {
    assert.deepEqual(connectSourcesForSupabase('https://example.supabase.co'), [
      'https://example.supabase.co',
      'wss://example.supabase.co',
    ]);
  });

  it('keeps local development origins available only when no backend is configured', () => {
    assert.deepEqual(connectSourcesForSupabase(''), [
      'http://127.0.0.1:*',
      'ws://127.0.0.1:*',
      'http://localhost:*',
      'ws://localhost:*',
    ]);
    assert.deepEqual(connectSourcesForSupabase('http://127.0.0.1:54321'), [
      'http://127.0.0.1:54321',
      'ws://127.0.0.1:54321',
    ]);
  });

  it('rejects remote plain HTTP and malformed backend URLs', () => {
    assert.throws(() => connectSourcesForSupabase('http://example.supabase.co'), /https/);
    assert.throws(() => connectSourcesForSupabase('example.supabase.co'), /absolute URL/);
  });

  it('builds a hash-based CSP without unsafe-inline or wildcard Supabase origins', () => {
    const csp = buildCsp(new Set(["'sha256-test'"]), 'https://example.supabase.co');
    assert.match(csp, /connect-src 'self' https:\/\/example\.supabase\.co wss:\/\/example\.supabase\.co/);
    assert.match(csp, /script-src 'self' 'sha256-test'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.doesNotMatch(csp, /\*\.supabase\.co/);
    assert.doesNotMatch(csp, /localhost/);
  });
});

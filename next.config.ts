import type { NextConfig } from 'next';

const publicKey = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  ''
).trim();

let isPrivateKey = publicKey.startsWith('sb_secret_');
if (publicKey.split('.').length === 3) {
  try {
    const payload = JSON.parse(Buffer.from(publicKey.split('.')[1], 'base64url').toString('utf8')) as { role?: string };
    isPrivateKey ||= payload.role === 'service_role';
  } catch { /* Invalid public configuration is reported by the terminal client. */ }
}
if (isPrivateKey) {
  throw new Error('A private Supabase key was assigned to a NEXT_PUBLIC_ variable. Use a publishable or anon key. Build stopped to prevent exposing credentials.');
}

const config: NextConfig = {
  output: 'export',
  poweredByHeader: false,
  devIndicators: false,
  experimental: { sri: { algorithm: 'sha256' } },
};

export default config;

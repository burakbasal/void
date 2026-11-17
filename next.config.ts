import type { NextConfig } from 'next';

const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
let isPrivateKey = publicKey.startsWith('sb_secret_');
if (publicKey.split('.').length === 3) {
  try {
    const payload = JSON.parse(Buffer.from(publicKey.split('.')[1], 'base64url').toString('utf8')) as { role?: string };
    isPrivateKey ||= payload.role === 'service_role';
  } catch { /* Invalid public configuration is reported by the terminal client. */ }
}
if (isPrivateKey) {
  throw new Error('A private Supabase key was assigned to NEXT_PUBLIC_SUPABASE_ANON_KEY. Use an anon or publishable key. Build stopped to prevent exposing credentials.');
}

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Content-Security-Policy', value: `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` }
    ] }];
  }
};
export default config;

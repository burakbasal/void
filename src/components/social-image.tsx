import { ImageResponse } from 'next/og';

export const socialImageSize = { width: 1200, height: 630 };
export const socialImageAlt = 'VOID — a quieter connection. A keyboard-first, real-time messaging terminal.';

export function createSocialImage(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: '#000000',
        color: '#b8b8b8',
        padding: '72px 80px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 21, color: '#767676', letterSpacing: 2 }}>
        <span>VOID / TERMINAL 01</span>
        <span>EST. 2026</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: 170, fontWeight: 700, letterSpacing: -6, color: '#f2f2f2', lineHeight: 1 }}>
          VOID
        </div>
        <div style={{ display: 'flex', fontSize: 46, color: '#8a8a8a', marginTop: 18 }}>
          a quieter connection
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', fontSize: 26, color: '#767676', lineHeight: 1.5 }}>
        <div style={{ display: 'flex' }}>~ › type login or register to begin</div>
        <div style={{ display: 'flex', fontSize: 18, color: '#767676', letterSpacing: 1, marginTop: 24 }}>
          NO NOISE&nbsp;&nbsp;//&nbsp;&nbsp;REAL TIME&nbsp;&nbsp;//&nbsp;&nbsp;KEYBOARD FIRST
        </div>
      </div>
    </div>,
    { ...socialImageSize },
  );
}

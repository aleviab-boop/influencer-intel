import { ImageResponse } from 'next/og';

// Generated social-share card (1200×630) used for Open Graph and Twitter.
// On-brand: soft violet gradient, three-dot mark, wordmark and tagline.
export const alt = 'Influencer Intel — India’s AI-native InfluencerOS';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  const dot = (bg: string) => ({ width: 34, height: 34, borderRadius: 999, background: bg, margin: '0 8px' });
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '90px',
          background: 'linear-gradient(135deg,#F4F2FF 0%,#ffffff 52%,#f2ecff 100%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={dot('#D83E83')} />
          <div style={dot('#4FB3D9')} />
          <div style={dot('#ECBF4C')} />
        </div>
        <div
          style={{
            marginTop: 40,
            fontSize: 92,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            color: '#111111',
            lineHeight: 1.05,
          }}
        >
          Influencer Intel
        </div>
        <div style={{ marginTop: 28, fontSize: 40, color: '#6C4DF6', fontWeight: 600 }}>
          Discover · Predict · Monitor
        </div>
        <div style={{ marginTop: 20, fontSize: 30, color: '#555555', maxWidth: 900, lineHeight: 1.35 }}>
          India’s AI-native platform to discover scored creators, predict performance and run campaigns end to end.
        </div>
      </div>
    ),
    { ...size },
  );
}

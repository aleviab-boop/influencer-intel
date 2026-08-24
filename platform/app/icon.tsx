import { ImageResponse } from 'next/og';

// Generated favicon — a purple gradient tile with the brand's three-dot motif
// (pink / white / yellow), echoing the BrandMark. Replaces the missing favicon.
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  const dot = { width: 6, height: 6, borderRadius: 999, margin: '0 1.5px' };
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg,#6C4DF6,#9b7bff)',
          borderRadius: 7,
        }}
      >
        <div style={{ ...dot, background: '#D83E83' }} />
        <div style={{ ...dot, background: '#ffffff' }} />
        <div style={{ ...dot, background: '#ECBF4C' }} />
      </div>
    ),
    { ...size },
  );
}

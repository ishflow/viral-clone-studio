import { ImageResponse } from 'next/og';
import { ART, LogoMark } from './share-art';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** The home-screen icon: the mark of the logo on the dark of the site. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: ART.bg }}>
        <LogoMark width={110} />
      </div>
    ),
    size,
  );
}

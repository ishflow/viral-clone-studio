import { ImageResponse } from 'next/og';
import { SITE } from '@/core/config';
import marketing from '@/messages/en/marketing.json';
import { ART, LogoMark } from './share-art';

export const alt = `${SITE.name}: ${marketing.home.heroLead} ${marketing.home.heroAccent}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The picture of a shared link to any public page: the logo and the promise of the home page, in the colors of the site. */
export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 80, background: ART.bg, color: ART.text }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 52 }}>
          <LogoMark width={78} />
          <span>{SITE.name.toLowerCase()}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 132, lineHeight: 1, letterSpacing: -4 }}>
          <span>{marketing.home.heroLead}</span>
          <span style={{ color: ART.accent }}>{marketing.home.heroAccent}</span>
        </div>
      </div>
    ),
    size,
  );
}

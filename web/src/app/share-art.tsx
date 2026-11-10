/** The colors of the dark theme of the site (`core/tokens.css`), for the pictures made in code (a picture cannot read the stylesheet). */
export const ART = { bg: '#0B0C0A', text: '#F2F3EC', accent: '#C8F03C' } as const;

/** The mark of the logo (`shared/ui/Logo`): an outlined phone frame and a lime one, `width` wide. */
export function LogoMark({ width }: { width: number }) {
  return (
    <svg width={width} height={(width * 32) / 42} viewBox="0 0 42 32" fill="none">
      <rect x="1.5" y="1.5" width="15" height="29" rx="3" stroke={ART.text} strokeWidth="3" />
      <rect x="25.5" y="1.5" width="15" height="29" rx="3" fill={ART.accent} stroke={ART.accent} strokeWidth="3" />
    </svg>
  );
}

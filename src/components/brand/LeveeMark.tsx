interface MarkProps {
  className?: string;
}

/**
 * The embankment cross-section mark: protected land on the left, the
 * water-side ripple on the right - this is the sub-24px reduction of
 * LeveeSeal below (its ring/ticks blur at favicon scale). Source and full
 * spec: public/brand/README.md.
 */
export function LeveeMark({ className }: MarkProps) {
  return (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true">
      <polyline points="15,84 35,84" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      <polygon points="35,84 50,39 70,39 85,84" fill="currentColor" />
      <polyline
        points="85,84 90,81 95,84 100,81 105,84"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The primary mark: LeveeMark set inside a 12-tick instrument bezel, in the
 * gauge/instrument vocabulary rather than a heraldic ring of text. Use this
 * anywhere above ~24px (header lockups, the landing page, letterhead); drop
 * to the plain LeveeMark below that, where the bezel's ticks blur.
 */
export function LeveeSeal({ className }: MarkProps) {
  return (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" strokeWidth="6" />
      <g stroke="currentColor" strokeWidth="3">
        <line x1="110" y1="60" x2="104" y2="60" />
        <line x1="103.3" y1="85" x2="98.1" y2="82" />
        <line x1="85" y1="103.3" x2="82" y2="98.1" />
        <line x1="60" y1="110" x2="60" y2="104" />
        <line x1="35" y1="103.3" x2="38" y2="98.1" />
        <line x1="16.7" y1="85" x2="21.9" y2="82" />
        <line x1="10" y1="60" x2="16" y2="60" />
        <line x1="16.7" y1="35" x2="21.9" y2="38" />
        <line x1="35" y1="16.7" x2="38" y2="21.9" />
        <line x1="60" y1="10" x2="60" y2="16" />
        <line x1="85" y1="16.7" x2="82" y2="21.9" />
        <line x1="103.3" y1="35" x2="98.1" y2="38" />
      </g>
      <g transform="translate(60,60) scale(0.8) translate(-60,-61.5)">
        <polyline points="15,84 35,84" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <polygon points="35,84 50,39 70,39 85,84" fill="currentColor" />
        <polyline
          points="85,84 90,81 95,84 100,81 105,84"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

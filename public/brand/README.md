# Levee Buddy mark

Source: "Levee Buddy Mark Concepts" (Claude.ai artifact, rev. 03, 2026-09-14) —
https://claude.ai/artifact/59drAS2T9N11JXXE7qU61F

Selected direction: the embankment cross-section actually used in levee
engineering drawings — protected land on the left, open water on the right —
not an invented icon.

## Two variants

- **`mark.svg`** — plain embankment + water ripple. Use at or below ~24px
  (favicon, nav rail, anywhere the bezel's ticks would blur).
- **`seal.svg`** — the same mark set inside a 12-tick instrument bezel. This
  is the *primary* mark; use it everywhere above ~24px (headers, the landing
  page, a printed inspection-report letterhead).

Both are shipped here as static reference files with the brand's light-theme
colors baked in (`#A9762F` brass, `#2B5A66` accent/water). In the app itself,
use the React components at `src/components/brand/LeveeMark.tsx`
(`LeveeMark` / `LeveeSeal`) instead of these files directly — they use
`currentColor` for the embankment and `var(--accent)` for the water, so the
mark tracks light/dark theme and whatever color the surrounding UI sets,
which a static file can't do.

## Construction

- Embankment side slope is true 1V:3H (USACE design guidance for an actual
  levee side slope) — don't round it off if you ever redraw this by hand.
- Stroke weights: `6` for the baseline/ripple/bezel ring, `3` for the bezel's
  graduation ticks (half of the ring weight).
- Clear space: 1× the mark's height on every side.

## Still open

No PNG/ICO export or app-icon/favicon wiring exists yet — only the SVGs
above and the two in-app usages (portal sidebar, marketing page). If this
needs to become a browser-tab favicon or app icon, generate those from
`seal.svg` (bezel reads better than the plain mark at icon sizes above 24px;
below that, `mark.svg`).

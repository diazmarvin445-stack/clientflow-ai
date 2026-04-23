# Equipo Layout Cutoff Fix Report

## Root cause of clipping

The Equipo module was being constrained by nested shell containers that rely on internal scrolling.  
Within that chain, the Equipo content block (`.eq-workspace` / `.eq-time-panel` / `.eq-members`) still had desktop-style side margins/padding and no explicit width/min-width safeguards, which caused clipping/trapped rendering on smaller viewports.

In practice:

- parent shell scroll existed, but child Equipo blocks could still appear cut;
- Control de jornada looked partially hidden because wrapper spacing + container constraints were not normalized for phone/tablet;
- some blocks behaved like fixed desktop cards inside a constrained scroller.

## CSS/layout rules changed

Updated files:

- `styles.css`
- `equipo.js` (debug logs only, no business logic changes)

### `styles.css` changes

- Hardened Equipo container sizing:
  - `.eq-workspace` now has `width: 100%`, `min-width: 0`, `box-sizing: border-box`.
  - `.eq-time-panel` now has `max-width: 100%`, `min-width: 0`, `box-sizing: border-box`.
  - `.eq-members` now has `min-width: 0`.
- Enforced stable scroll behavior for Equipo:
  - `.eq-page .dash-main { overflow-y: auto; overflow-x: hidden; min-height: 0; }`
  - `.eq-page .eq-panel { overflow: visible; }`
- Added responsive spacing overrides:
  - Tablet (`<=1024px`): reduced workspace spacing and removed lateral margins from stats/time/members blocks.
  - Mobile (`<=640px`): compact workspace, compact panel head/time panel, full-width action buttons, vertical unfinished rows, tighter member card padding.

## How scrolling works now

- Equipo continues using internal app scrolling via `.dash-main`.
- The module content now flows vertically without being clipped by child widths/margins.
- Control de jornada is fully reachable by natural scroll on phone/tablet/desktop.

## Mobile vs desktop behavior now

- **Mobile:** fully stacked layout, full-width action buttons, no cut cards, no overflow clipping.
- **Tablet:** reduced side spacing and cleaner vertical flow while preserving readability.
- **Desktop:** keeps normal wide layout, with non-clipping panel/content behavior.

## Debug instrumentation added

In `equipo.js`, added layout logs:

- `[Equipo Layout] module mounted` on successful load
- same metric log on resize (debounced)

Logged metrics include:

- `dash-main` client/scroll height
- `.eq-workspace` client/scroll height
- `#eq-time-panel` client/scroll height

This helps validate when container clipping reappears.

# Dashboard Visual Cleanup Report

## Dark mode fixes made
- Improved contrast for dashboard typography in dark theme:
  - section titles (`dash-panel-title`, widget titles, business name)
  - secondary metadata (`dash-stat-label`, topbar meta/greeting, muted text)
  - upcoming events text
- Improved dark panel header separation:
  - clearer dark header background gradient
  - stronger but subtle header border separation
- Improved dark readability for cards/alerts:
  - mini cards now keep readable text color
  - alert strip adjusted to a higher-contrast dark palette
  - upcoming list area gets a subtle background + divider for visual clarity

## What was compacted
- Dashboard summary view (`dash-body--summary`) was made more compact:
  - panel shadows reduced for lighter feel
  - panel header padding reduced
  - sales chart max-height reduced
  - upcoming events list spacing/size reduced
- Mobile cleanup (`max-width: 720px`):
  - tighter alert strip
  - tighter panel spacing and title size
  - smaller mini cards and single-column rhythm
  - upcoming events block reduced padding/line spacing for compact scan

## What remains unchanged functionally
- No JavaScript behavior was changed.
- Dashboard data rendering remains unchanged.
- Sales chart logic remains unchanged.
- Calendar/order/navigation logic remains unchanged.
- No new click/open behavior was added to upcoming events.

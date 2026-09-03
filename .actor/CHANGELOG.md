## 1.2 — JavaScript ordering-page support

- Added residential proxy configuration and a fast HTTP-to-browser fallback.
- Added rendered menu-row extraction for JavaScript ordering pages.
- Pinned the Node 24 / Playwright 1.58.1 runtime and raised the browser memory envelope.
- Live-validated three public Toast menus (203 items) and a zero-false-change second run.

## 1.1 — Conversion and intelligence upgrade

- Added automatic same-site menu-page discovery from ordinary restaurant URLs.
- Added embedded application-state parsing, availability changes, severity, and extraction confidence.
- Added keyword, event-type, and minimum price-move filters plus optional complete snapshots.
- Changed PPE from per-menu-item deltas to predictable per-restaurant scans and changed-restaurant reports.

## 1.0 — Initial private build

- Added JSON-LD and server-rendered HTML menu extraction.
- Added persistent baselines and six menu-change event types.
- Added webhook delivery, run summaries, input/output schemas, and PPE hooks.

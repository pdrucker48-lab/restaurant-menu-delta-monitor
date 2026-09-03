# Store listing: Restaurant Competitor Menu & Price Monitor

## Search title

Restaurant Competitor Menu & Price Monitor

## Short description

Track competitor prices, new and removed dishes, availability, descriptions, and category changes from public restaurant menus and ordering pages.

## Opening pitch

Stop rebuilding competitor menus by hand. Paste restaurant homepages or menu URLs once, schedule the Actor, and receive only the pricing and menu decisions that changed.

The Actor normalizes public structured, server-rendered, and JavaScript ordering-page menus, preserves a baseline, and returns old/current evidence with severity and extraction confidence. Browser rendering is used only when the fast HTML path finds no menu items.

## Outcome-led use cases

1. Find which competitors raised burger, entrée, or combo prices this week.
2. Detect seasonal launches and removed dishes before the next pricing meeting.
3. Monitor sold-out or newly available products across a market.
4. Feed clean deltas into Sheets, BI, Slack, n8n/Make, or an AI workflow.

## Recommended pricing

- `restaurant-scan`: $0.05 per successful restaurant
- `changed-restaurant`: $0.05 per restaurant containing matched changes
- Failed extractions: free

Disable the automatic `apify-default-dataset-item` event before launch to prevent double charging.

## First-run expectation

The first run creates a baseline and returns a compact confirmation summary. Schedule the same input with the same `monitorKey` to receive deltas.

Use exact ordering URLs for the best results. Public Toast menu pages are live-tested; residential proxy traffic and JavaScript rendering are enabled by default. Failed extractions remain free and are listed in the run summary.

## Suggested categories and search terms

E-commerce; Business; Automation; restaurant menu scraper; restaurant price monitoring; competitor pricing; menu intelligence; food price data; restaurant analytics.

## Publication gate

Keep a recurring platform-specific smoke suite at or above 70% extraction success and verify the second run produces no false changes. The live 10-site Toast suite parsed 7/10 menus and 998 items on its first run, then 8/10 on the immediate second run with zero raw or matched changes.

# Store listing: Restaurant Competitor Menu & Price Monitor

## Search title

Restaurant Competitor Menu & Price Monitor

## Short description

Track competitor restaurant prices, new and removed dishes, availability, descriptions, and category changes from ordinary public website URLs.

## Opening pitch

Stop rebuilding competitor menus by hand. Paste restaurant homepages or menu URLs once, schedule the Actor, and receive only the pricing and menu decisions that changed.

The Actor automatically discovers same-site menu pages, normalizes public structured and server-rendered menu data, preserves a baseline, and returns old/current evidence with severity and extraction confidence.

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

## Suggested categories and search terms

E-commerce; Business; Automation; restaurant menu scraper; restaurant price monitoring; competitor pricing; menu intelligence; food price data; restaurant analytics.

## Publication gate

Run the included 20-site smoke test in an Apify environment. Publish after at least 70% of the selected public sites return credible normalized menus and manually inspect a sample for false product matches.

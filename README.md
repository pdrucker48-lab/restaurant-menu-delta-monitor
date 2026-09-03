# Restaurant Competitor Menu & Price Monitor

Turn ordinary restaurant URLs into a recurring competitor-intelligence feed. The Actor discovers same-site menu pages, builds a normalized baseline, and reports only material menu and pricing decisions on later runs.

## Best for

- restaurant groups benchmarking local competitors;
- franchise and hospitality agencies monitoring many locations;
- food distributors watching category and ingredient trends;
- restaurant-data and market-research pipelines.

## Paste URLs, not scraper instructions

Input a restaurant homepage or exact menu page. The Actor follows the strongest same-site menu links and extracts from:

- Schema.org `Menu`, `MenuSection`, `MenuItem`, and `Product` JSON-LD;
- public application-state JSON embedded in the page;
- common server-rendered menu markup and microdata.

No login, browser automation, access-control bypass, OCR, or AI billing is used.

## Intelligence events

- `ITEM_ADDED` and `ITEM_REMOVED`
- `PRICE_UP` and `PRICE_DOWN`
- `AVAILABILITY_CHANGED`
- `DESCRIPTION_CHANGED`
- `CATEGORY_CHANGED`

Every event contains old/current evidence, integer-cent price movement, percentage movement, source URL, severity, extraction confidence, detection time, and a deterministic fingerprint. A run summary ranks the largest price moves and counts changed restaurants.

## Noise controls

Use `minimumPriceChangePercent`, `keywords`, and `eventTypes` to deliver only changes relevant to a buyer's watchlist. `emitFullSnapshot` turns the same Actor into a normalized menu feed; leave it off for an exception-only monitoring workflow.

## First and later runs

The first run always writes one `BASELINE_SUMMARY` per successfully parsed restaurant, so setup is visibly confirmed without flooding the dataset. Set `emitBaseline` to include every item. Reuse the same `monitorKey` on a schedule to compare with that state.

## Example input

```json
{
  "restaurantUrls": [
    "https://restaurant-a.example/",
    "https://restaurant-b.example/menu"
  ],
  "monitorKey": "toronto-burger-competitors",
  "currencyFallback": "CAD",
  "maxPagesPerRestaurant": 3,
  "minimumPriceChangePercent": 2,
  "keywords": ["burger", "chicken", "combo"],
  "emitFullSnapshot": false
}
```

## Recommended schedule

Run weekly for ordinary competitor pricing, daily during promotion or seasonal-menu periods, and reuse the same `monitorKey`. Results are available as JSON/CSV through the default dataset and can also be delivered to an HTTPS webhook.

## Recommended Store pricing

Configure two simple pay-per-event charges:

- `restaurant-scan` — **$0.05 per successfully parsed restaurant**;
- `changed-restaurant` — **$0.05 per restaurant with one or more matched changes**.

Remove the automatic `apify-default-dataset-item` event in the pricing setup so summary and evidence rows are not double-charged.

This prices a scan below the leading broad menu extractor while charging for the recurring state and alert layer. Failed restaurants are not charged. Offer initial Store trial credit rather than artificially billing every menu item.

## Local validation

```bash
npm install
npm test
npm run smoke
```

The unit suite covers JSON-LD, public application-state extraction, international prices, all change classes, severity, and filtering. The optional smoke test checks 20 public restaurant sites and requires a 70% parse rate.

## Responsible use

Only public business-menu information is processed. Customers remain responsible for source terms, robots directives, rate limits, and applicable law.

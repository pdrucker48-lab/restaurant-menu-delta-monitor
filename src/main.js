import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';
import { chromium } from 'playwright';
import {
  canonicalizeUrl,
  deduplicateItems,
  diffMenus,
  filterChanges,
  sha256,
  stateKey,
  storeName,
} from './lib/menu.js';
import {
  discoverMenuLinks,
  extractRestaurantName,
  parseMenuDocument,
} from './lib/html-menu.js';

const DEFAULTS = {
  monitorKey: 'default',
  currencyFallback: 'USD',
  emitBaseline: false,
  emitFullSnapshot: false,
  requestTimeoutSecs: 25,
  maxConcurrency: 5,
  maxPagesPerRestaurant: 3,
  useBrowserFallback: true,
  renderWaitSecs: 3,
  proxyConfiguration: {
    useApifyProxy: true,
    apifyProxyGroups: ['RESIDENTIAL'],
    apifyProxyCountry: 'US',
  },
  minimumPriceChangePercent: 0,
  keywords: [],
  eventTypes: [],
};

function validateInput(input) {
  const urls = [...new Set((input.restaurantUrls ?? []).map(canonicalizeUrl))];
  if (!urls.length) throw new Error('restaurantUrls must contain at least one valid public URL.');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.monitorKey)) throw new Error('monitorKey contains unsupported characters.');
  if (input.webhookUrl && new URL(input.webhookUrl).protocol !== 'https:') throw new Error('webhookUrl must use HTTPS.');
  return { ...input, restaurantUrls: urls };
}

async function mapConcurrent(values, concurrency, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  async function run() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run));
  return results;
}

async function safeCharge(eventName, count = 1) {
  if ((!process.env.APIFY_IS_AT_HOME && !process.env.ACTOR_TEST_PAY_PER_EVENT)
    || typeof Actor.charge !== 'function' || count <= 0) return;
  try {
    await Actor.charge({ eventName, count });
  } catch (error) {
    log.warning(`Could not charge ${eventName}: ${error.message}`);
  }
}

async function fetchHtml(url, input, proxyConfiguration) {
  const sessionId = `menu_${sha256(new URL(url).hostname).slice(0, 24)}`;
  const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl(sessionId) : undefined;
  const response = await gotScraping({
    url,
    proxyUrl,
    followRedirect: true,
    maxRedirects: 5,
    throwHttpErrors: false,
    retry: { limit: 1 },
    timeout: { request: input.requestTimeoutSecs * 1000 },
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'en-US,en;q=0.9',
    },
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`HTTP ${response.statusCode}`);
  }
  const contentType = String(response.headers['content-type'] ?? '');
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error(`Unsupported content type: ${contentType || 'unknown'}`);
  }
  const declaredBytes = Number(response.headers['content-length'] ?? 0);
  if (declaredBytes > 5_000_000) throw new Error('Menu page exceeds the 5 MB safety limit.');
  const html = response.body;
  if (Buffer.byteLength(html) > 5_000_000) throw new Error('Menu page exceeds the 5 MB safety limit.');
  return { html, finalUrl: response.url || url };
}

async function launchRenderedBrowser(proxyConfiguration) {
  const proxyUrl = proxyConfiguration
    ? await proxyConfiguration.newUrl('menushift_browser')
    : null;
  let proxy;
  if (proxyUrl) {
    const parsed = new URL(proxyUrl);
    proxy = {
      server: `${parsed.protocol}//${parsed.hostname}:${parsed.port}`,
      username: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
    };
  }
  return chromium.launch({
    headless: true,
    proxy,
    args: ['--disable-dev-shm-usage'],
  });
}

async function renderHtml(url, input, browser) {
  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
  try {
    const page = await context.newPage();
    await page.route('**/*', async (route) => {
      const resourceType = route.request().resourceType();
      if (['font', 'image', 'media'].includes(resourceType)) await route.abort();
      else await route.continue();
    });
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: input.requestTimeoutSecs * 1000,
    });
    if (response && response.status() >= 400) throw new Error(`Browser HTTP ${response.status()}`);
    await page.waitForTimeout(input.renderWaitSecs * 1000);
    const html = await page.content();
    if (Buffer.byteLength(html) > 10_000_000) throw new Error('Rendered menu page exceeds the 10 MB safety limit.');
    return { html, finalUrl: page.url() || url };
  } finally {
    await context.close();
  }
}

async function inspectRestaurant(restaurantUrl, input, proxyConfiguration, getRenderedBrowser) {
  const queue = [restaurantUrl];
  const visited = new Set();
  const collected = [];
  const pages = [];
  let restaurantName = null;

  while (queue.length && visited.size < input.maxPagesPerRestaurant) {
    const candidate = queue.shift();
    const canonical = canonicalizeUrl(candidate);
    if (visited.has(canonical)) continue;
    visited.add(canonical);

    try {
      let document;
      let transport = 'http';
      try {
        document = await fetchHtml(canonical, input, proxyConfiguration);
      } catch (error) {
        if (!input.useBrowserFallback) throw error;
        document = await renderHtml(canonical, input, await getRenderedBrowser());
        transport = 'browser';
      }

      let { html, finalUrl } = document;
      let pageItems = parseMenuDocument(html, input.currencyFallback);
      if (!pageItems.length && input.useBrowserFallback && transport !== 'browser') {
        ({ html, finalUrl } = await renderHtml(canonical, input, await getRenderedBrowser()));
        pageItems = parseMenuDocument(html, input.currencyFallback);
        transport = 'browser';
      }
      restaurantName ||= extractRestaurantName(html);
      pageItems = pageItems
        .map((item) => ({ ...item, sourceUrl: finalUrl }));
      collected.push(...pageItems);
      pages.push({ url: finalUrl, itemsFound: pageItems.length, transport, fingerprint: sha256(html) });

      if (visited.size === 1) {
        for (const link of discoverMenuLinks(html, finalUrl, input.maxPagesPerRestaurant - 1)) {
          if (!visited.has(link)) queue.push(link);
        }
      }
    } catch (error) {
      pages.push({ url: canonical, itemsFound: 0, error: error.message });
      if (visited.size === 1 && queue.length === 0) throw error;
    }
  }

  const items = deduplicateItems(collected);
  if (!items.length) throw new Error('No structured or server-rendered menu items were found.');
  const sourceKinds = [...new Set(items.map((item) => item.source))];
  const extractionConfidence = sourceKinds.includes('json-ld') ? 'HIGH'
    : sourceKinds.includes('embedded-json') ? 'MEDIUM'
      : 'LOW';

  return { restaurantName, items, pages, sourceKinds, extractionConfidence };
}

await Actor.init();

let renderedBrowserPromise;

try {
  const input = validateInput({ ...DEFAULTS, ...(await Actor.getInput()) });
  const proxyConfiguration = input.proxyConfiguration
    ? await Actor.createProxyConfiguration(input.proxyConfiguration)
    : undefined;
  const getRenderedBrowser = async () => {
    renderedBrowserPromise ||= launchRenderedBrowser(proxyConfiguration);
    return renderedBrowserPromise;
  };
  const store = await Actor.openKeyValueStore(storeName(input.monitorKey));
  const detectedAt = new Date().toISOString();
  const allChanges = [];
  const baselineRecords = [];
  const snapshotRecords = [];
  const failures = [];
  const changedRestaurants = new Set();
  let rawChangesDetected = 0;

  await mapConcurrent(input.restaurantUrls, input.maxConcurrency, async (restaurantUrl) => {
    try {
      const result = await inspectRestaurant(restaurantUrl, input, proxyConfiguration, getRenderedBrowser);
      const key = stateKey(restaurantUrl);
      const previous = await store.getValue(key);
      const snapshot = {
        schemaVersion: 2,
        restaurantUrl,
        restaurantName: result.restaurantName,
        capturedAt: detectedAt,
        pages: result.pages,
        extractionConfidence: result.extractionConfidence,
        items: result.items,
      };

      if (previous?.items) {
        const rawChanges = diffMenus(previous.items, result.items, restaurantUrl, detectedAt)
          .map((change) => ({
            ...change,
            restaurantName: result.restaurantName ?? previous.restaurantName ?? null,
            extractionConfidence: result.extractionConfidence,
          }));
        rawChangesDetected += rawChanges.length;
        const deliveredChanges = filterChanges(rawChanges, input);
        if (deliveredChanges.length) {
          allChanges.push(...deliveredChanges);
          changedRestaurants.add(restaurantUrl);
        }
      } else {
        baselineRecords.push({
          recordType: 'BASELINE_SUMMARY',
          eventType: 'BASELINE_SUMMARY',
          restaurantUrl,
          restaurantName: result.restaurantName,
          itemsTracked: result.items.length,
          pagesRead: result.pages.length,
          sourceKinds: result.sourceKinds,
          extractionConfidence: result.extractionConfidence,
          detectedAt,
          fingerprint: sha256(`${restaurantUrl}|baseline|${JSON.stringify(result.items)}`),
        });
        if (input.emitBaseline) {
          baselineRecords.push(...result.items.map((item) => ({
            recordType: 'BASELINE_ITEM',
            eventType: 'BASELINE_ITEM',
            restaurantUrl,
            restaurantName: result.restaurantName,
            itemName: item.name,
            category: item.category,
            previous: null,
            current: item,
            priceChangePercent: null,
            severity: 'INFO',
            extractionConfidence: result.extractionConfidence,
            detectedAt,
            fingerprint: sha256(`${restaurantUrl}|${JSON.stringify(item)}`),
          })));
        }
      }

      if (input.emitFullSnapshot) {
        snapshotRecords.push(...result.items.map((item) => ({
          recordType: 'MENU_SNAPSHOT',
          eventType: 'MENU_SNAPSHOT',
          restaurantUrl,
          restaurantName: result.restaurantName,
          itemName: item.name,
          category: item.category,
          current: item,
          extractionConfidence: result.extractionConfidence,
          detectedAt,
          fingerprint: sha256(`${restaurantUrl}|snapshot|${detectedAt}|${JSON.stringify(item)}`),
        })));
      }

      await store.setValue(key, snapshot);
      await safeCharge('restaurant-scan');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warning(`Failed to inspect ${restaurantUrl}: ${message}`);
      failures.push({ restaurantUrl, error: message });
    }
  });

  if (baselineRecords.length) await Actor.pushData(baselineRecords);
  if (snapshotRecords.length) await Actor.pushData(snapshotRecords);
  if (allChanges.length) await Actor.pushData(allChanges);
  if (changedRestaurants.size) await safeCharge('changed-restaurant', changedRestaurants.size);

  const checked = input.restaurantUrls.length - failures.length;
  const summary = {
    recordType: 'RUN_SUMMARY',
    eventType: 'RUN_SUMMARY',
    monitorKey: input.monitorKey,
    checkedAt: detectedAt,
    restaurantsRequested: input.restaurantUrls.length,
    restaurantsChecked: checked,
    restaurantsFailed: failures.length,
    restaurantsChanged: changedRestaurants.size,
    rawChangesDetected,
    matchingChangesDelivered: allChanges.length,
    highSeverityChanges: allChanges.filter((change) => change.severity === 'HIGH').length,
    largestPriceMoves: allChanges
      .filter((change) => change.priceChangePercent != null)
      .sort((a, b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent))
      .slice(0, 10),
    failures,
  };
  await Actor.pushData(summary);
  await store.setValue('LATEST_RUN', summary);

  if (input.webhookUrl) {
    const response = await fetch(input.webhookUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(input.requestTimeoutSecs * 1000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ summary, changes: allChanges }),
    });
    if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}.`);
  }
} finally {
  if (renderedBrowserPromise) await (await renderedBrowserPromise).close();
  await Actor.exit();
}

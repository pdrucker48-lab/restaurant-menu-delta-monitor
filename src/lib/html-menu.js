import * as cheerio from 'cheerio';
import {
  deduplicateItems,
  extractEmbeddedJsonMenus,
  extractJsonLdMenus,
  normalizeAvailability,
  normalizePrice,
  normalizeText,
} from './menu.js';

const ITEM_SELECTORS = [
  '[itemtype*="MenuItem"]',
  '[itemtype*="Product"]',
  '.menu-item',
  '[class*="menu-item"]',
  '[class*="menuItem"]',
].join(',');

const RENDERED_ITEM_SELECTORS = [
  'button',
  '[role="button"]',
  'article',
  'li',
  '[data-testid*="item"]',
  '[class*="product"]',
].join(',');

const PRICE_PATTERN = /(?:[$£€]\s*\d{1,4}(?:[.,]\d{2})?|\d{1,4}(?:[.,]\d{2})\s*(?:USD|CAD|GBP|EUR))/i;

function textFrom($root, selectors) {
  for (const selector of selectors) {
    const value = normalizeText($root.find(selector).first().text());
    if (value) return value;
  }
  return '';
}

function inferCategory($, element) {
  const explicit = normalizeText($(element).attr('data-category'));
  if (explicit) return explicit;
  const section = $(element).closest('section, article, [class*="section"], [class*="category"]');
  return textFrom(section, ['[itemprop="name"]', 'h1', 'h2', 'h3']);
}

export function extractHtmlMenu(html, currencyFallback = 'USD') {
  const $ = cheerio.load(html);
  const items = [];
  $(ITEM_SELECTORS).each((_, element) => {
    const root = $(element);
    const name = textFrom(root, ['[itemprop="name"]', '.name', '[class*="item-name"]', 'h2', 'h3', 'h4']);
    const priceText = textFrom(root, ['[itemprop="price"]', '.price', '[class*="price"]']);
    if (!name || !priceText) return;
    const currency = root.find('[itemprop="priceCurrency"]').attr('content') || currencyFallback;
    items.push({
      name,
      description: textFrom(root, ['[itemprop="description"]', '.description', '[class*="description"]', 'p']),
      category: inferCategory($, element),
      ...normalizePrice(priceText, currency),
      availability: normalizeAvailability(
        root.find('[itemprop="availability"]').attr('href')
        || root.find('[itemprop="availability"]').attr('content')
        || root.text(),
      ),
      sourceId: root.attr('data-item-id') || root.attr('data-product-id') || root.attr('id') || '',
      source: 'html',
    });
  });
  return deduplicateItems(items);
}

export function extractRenderedTextMenu(html, currencyFallback = 'USD') {
  const $ = cheerio.load(html);
  const items = [];
  $(RENDERED_ITEM_SELECTORS).each((_, element) => {
    const root = $(element);
    const text = normalizeText(root.text());
    if (text.length < 4 || text.length > 500) return;
    const priceText = text.match(PRICE_PATTERN)?.[0];
    if (!priceText) return;

    const explicitName = textFrom(root, [
      '[data-testid*="name"]',
      '[class*="name"]',
      'h2',
      'h3',
      'h4',
    ]);
    const segments = root.text().split(/\n+/).map(normalizeText).filter(Boolean);
    const inferredName = segments.find((segment) => (
      !PRICE_PATTERN.test(segment)
      && !/^(add|order|select|customize|unavailable|sold out)$/i.test(segment)
      && segment.length >= 2
      && segment.length <= 120
    ));
    const name = explicitName || inferredName;
    if (!name || PRICE_PATTERN.test(name)) return;

    const description = textFrom(root, [
      '[data-testid*="description"]',
      '[class*="description"]',
      'p',
    ]);
    items.push({
      name,
      description,
      category: inferCategory($, element),
      ...normalizePrice(priceText, currencyFallback),
      availability: normalizeAvailability(text),
      sourceId: root.attr('data-item-id') || root.attr('data-testid') || root.attr('id') || '',
      source: 'rendered-text',
    });
  });
  return deduplicateItems(items);
}

export function parseMenuDocument(html, currencyFallback = 'USD') {
  const jsonLd = extractJsonLdMenus(html, currencyFallback);
  const embeddedJson = extractEmbeddedJsonMenus(html, currencyFallback);
  const htmlItems = extractHtmlMenu(html, currencyFallback);
  const renderedText = extractRenderedTextMenu(html, currencyFallback);
  return deduplicateItems([...jsonLd, ...embeddedJson, ...htmlItems, ...renderedText]);
}

export function discoverMenuLinks(html, baseUrl, limit = 3) {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const candidates = [];
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    const label = normalizeText($(element).text());
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) return;
    try {
      const url = new URL(href, base);
      if (url.hostname !== base.hostname || !['http:', 'https:'].includes(url.protocol)) return;
      url.hash = '';
      const signal = `${label} ${url.pathname}`.toLowerCase();
      let score = 0;
      if (/\b(full )?menu\b/.test(signal)) score += 10;
      if (/\b(food|drink|dining|eat|order)\b/.test(signal)) score += 4;
      if (/\b(catering|nutrition|privacy|career|gift|contact)\b/.test(signal)) score -= 5;
      if (score > 0) candidates.push({ url: url.toString(), score });
    } catch {
      // Ignore malformed third-party links.
    }
  });
  return [...new Map(candidates.sort((a, b) => b.score - a.score).map((item) => [item.url, item])).values()]
    .slice(0, limit)
    .map((item) => item.url);
}

export function extractRestaurantName(html) {
  const $ = cheerio.load(html);
  const candidates = [
    $('meta[property="og:site_name"]').attr('content'),
    $('meta[name="application-name"]').attr('content'),
    $('h1').first().text(),
    $('title').text().split(/[|–—]/)[0],
  ];
  return candidates.map(normalizeText).find(Boolean) || null;
}

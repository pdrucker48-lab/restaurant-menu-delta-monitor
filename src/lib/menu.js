import { createHash } from 'node:crypto';

const MENU_ITEM_TYPES = new Set(['menuitem', 'product']);

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function canonicalizeUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

export function normalizePrice(value, currencyFallback = 'USD') {
  if (value == null || value === '') return { priceCents: null, currency: currencyFallback.toUpperCase() };
  const raw = typeof value === 'object' ? value.price ?? value.lowPrice ?? value.highPrice : value;
  const currency = typeof value === 'object'
    ? value.priceCurrency ?? value.currency ?? currencyFallback
    : currencyFallback;
  const match = String(raw).replace(/\s/g, '').match(/-?\d[\d.,]*/);
  if (!match) return { priceCents: null, currency: String(currency).toUpperCase() };
  const token = match[0];
  const lastDot = token.lastIndexOf('.');
  const lastComma = token.lastIndexOf(',');
  const decimalIndex = Math.max(lastDot, lastComma);
  const fractionalDigits = decimalIndex >= 0 ? token.length - decimalIndex - 1 : 0;
  const hasDecimal = fractionalDigits > 0 && fractionalDigits <= 2;
  const integerPart = hasDecimal ? token.slice(0, decimalIndex) : token;
  const fractionPart = hasDecimal ? token.slice(decimalIndex + 1) : '';
  const normalized = `${integerPart.replace(/[.,]/g, '')}${hasDecimal ? `.${fractionPart}` : ''}`;
  return {
    priceCents: Math.round(Number(normalized) * 100),
    currency: String(currency).toUpperCase(),
  };
}

export function normalizeAvailability(value) {
  if (value === true) return 'UNAVAILABLE';
  if (value === false) return 'AVAILABLE';
  const text = normalizeText(value).toLowerCase();
  if (!text) return null;
  if (/outofstock|sold[ -]?out|unavailable|not available/.test(text)) return 'UNAVAILABLE';
  if (/instock|available|order now/.test(text)) return 'AVAILABLE';
  return null;
}

function asTypes(value) {
  return (Array.isArray(value) ? value : [value])
    .filter(Boolean)
    .map((type) => String(type).toLowerCase());
}

function extractOffers(node) {
  const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
  if (!offers) return node.price ?? null;
  const specification = Array.isArray(offers.priceSpecification)
    ? offers.priceSpecification[0]
    : offers.priceSpecification;
  return specification ?? offers;
}

function walkJson(value, category, output, currencyFallback) {
  if (Array.isArray(value)) {
    for (const child of value) walkJson(child, category, output, currencyFallback);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const types = asTypes(value['@type']);
  const nextCategory = types.includes('menusection') && value.name
    ? normalizeText(value.name)
    : category;

  if (types.some((type) => MENU_ITEM_TYPES.has(type)) && value.name) {
    const offers = extractOffers(value);
    const price = normalizePrice(offers, value.priceCurrency ?? currencyFallback);
    output.push({
      name: normalizeText(value.name),
      description: normalizeText(value.description),
      category: nextCategory || normalizeText(value.category),
      ...price,
      availability: normalizeAvailability(offers?.availability ?? value.availability),
      sourceId: normalizeText(value.sku ?? value.productID ?? value['@id']),
      source: 'json-ld',
    });
  }

  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('@')) continue;
    walkJson(child, nextCategory, output, currencyFallback);
  }
}

export function extractJsonLdMenus(html, currencyFallback = 'USD') {
  const items = [];
  const pattern = /<script\b[^>]*type=["'][^"']*application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = match[1].trim().replace(/^<!--|-->$/g, '').trim();
    try {
      walkJson(JSON.parse(raw), '', items, currencyFallback);
    } catch {
      // Invalid third-party JSON-LD is ignored; the HTML fallback may still parse it.
    }
  }
  return deduplicateItems(items);
}

function embeddedPrice(node) {
  for (const key of ['priceCents', 'price_cents', 'unitAmount', 'amount', 'price']) {
    if (node[key] == null || typeof node[key] === 'object') continue;
    const raw = node[key];
    if (/(cents|unitAmount|price_cents)/i.test(key) && Number.isFinite(Number(raw))) {
      return { priceCents: Math.round(Number(raw)), priceSourceKey: key };
    }
    if (Number.isFinite(Number(raw)) && Number(raw) > 250 && !String(raw).includes('.')) {
      return { priceCents: Math.round(Number(raw)), priceSourceKey: key };
    }
    return { priceCents: normalizePrice(raw).priceCents, priceSourceKey: key };
  }
  return null;
}

function walkEmbeddedJson(value, category, output, currencyFallback, depth = 0) {
  if (depth > 20) return;
  if (Array.isArray(value)) {
    for (const child of value) walkEmbeddedJson(child, category, output, currencyFallback, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const nextCategory = normalizeText(
    value.categoryName ?? value.sectionName ?? value.menuSectionName ?? category,
  );
  const price = embeddedPrice(value);
  const name = normalizeText(value.name ?? value.itemName ?? value.productName);
  const looksLikeItem = name
    && price?.priceCents != null
    && price.priceCents >= 0
    && price.priceCents <= 500_000;

  if (looksLikeItem) {
    const currency = normalizeText(value.currency ?? value.currencyCode ?? currencyFallback).toUpperCase();
    output.push({
      name,
      description: normalizeText(value.description ?? value.itemDescription),
      category: nextCategory,
      priceCents: price.priceCents,
      currency,
      availability: normalizeAvailability(value.availability ?? value.status ?? value.soldOut),
      sourceId: normalizeText(value.id ?? value.itemId ?? value.productId ?? value.sku),
      source: 'embedded-json',
    });
  }

  for (const child of Object.values(value)) {
    walkEmbeddedJson(child, nextCategory, output, currencyFallback, depth + 1);
  }
}

export function extractEmbeddedJsonMenus(html, currencyFallback = 'USD') {
  const items = [];
  const pattern = /<script\b[^>]*type=["'][^"']*application\/json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    if (/application\/ld\+json/i.test(match[0])) continue;
    const raw = match[1].trim().replace(/^<!--|-->$/g, '').trim();
    if (!raw || raw.length > 5_000_000) continue;
    try {
      walkEmbeddedJson(JSON.parse(raw), '', items, currencyFallback);
    } catch {
      // Third-party hydration payloads are best-effort only.
    }
  }
  return deduplicateItems(items);
}

export function deduplicateItems(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (!item.name) continue;
    const fingerprint = [
      normalizeText(item.name).toLowerCase(),
      normalizeText(item.category).toLowerCase(),
      item.priceCents ?? '',
      normalizeText(item.description).toLowerCase(),
    ].join('|');
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    output.push({
      name: normalizeText(item.name),
      description: normalizeText(item.description),
      category: normalizeText(item.category),
      priceCents: Number.isInteger(item.priceCents) ? item.priceCents : null,
      currency: String(item.currency || 'USD').toUpperCase(),
      availability: normalizeAvailability(item.availability),
      sourceId: normalizeText(item.sourceId),
      sourceUrl: item.sourceUrl || null,
      source: item.source || 'unknown',
    });
  }
  return output.sort((a, b) => `${a.category}\0${a.name}`.localeCompare(`${b.category}\0${b.name}`));
}

function keyPart(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function indexMenu(items) {
  const counts = new Map();
  for (const item of items) {
    const name = keyPart(item.name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const index = new Map();
  for (const item of items) {
    const name = keyPart(item.name);
    const key = counts.get(name) === 1 ? name : `${name}|${keyPart(item.category)}`;
    index.set(key, item);
  }
  return index;
}

function event(eventType, restaurantUrl, previous, current, detectedAt) {
  const item = current ?? previous;
  const percent = previous?.priceCents && current?.priceCents
    ? Number((((current.priceCents - previous.priceCents) / previous.priceCents) * 100).toFixed(2))
    : null;
  const payload = {
    recordType: 'MENU_CHANGE',
    eventType,
    restaurantUrl,
    itemName: item.name,
    category: item.category,
    previous: previous ?? null,
    current: current ?? null,
    priceChangePercent: percent,
    absolutePriceChangeCents: previous?.priceCents != null && current?.priceCents != null
      ? current.priceCents - previous.priceCents
      : null,
    detectedAt,
  };
  return {
    ...payload,
    severity: eventSeverity(eventType, percent, current),
    fingerprint: sha256(JSON.stringify(payload)),
  };
}

function eventSeverity(eventType, percent, current) {
  if (eventType === 'AVAILABILITY_CHANGED' && current?.availability === 'UNAVAILABLE') return 'HIGH';
  if (eventType.startsWith('PRICE_') && Math.abs(percent ?? 0) >= 10) return 'HIGH';
  if (['ITEM_ADDED', 'ITEM_REMOVED', 'PRICE_UP', 'PRICE_DOWN'].includes(eventType)) return 'MEDIUM';
  return 'LOW';
}

export function diffMenus(previousItems, currentItems, restaurantUrl, detectedAt = new Date().toISOString()) {
  const before = indexMenu(previousItems);
  const after = indexMenu(currentItems);
  const changes = [];

  for (const [key, current] of after) {
    const previous = before.get(key);
    if (!previous) {
      changes.push(event('ITEM_ADDED', restaurantUrl, null, current, detectedAt));
      continue;
    }
    if (previous.priceCents !== current.priceCents || previous.currency !== current.currency) {
      const type = previous.priceCents != null && current.priceCents != null && current.priceCents < previous.priceCents
        ? 'PRICE_DOWN'
        : 'PRICE_UP';
      changes.push(event(type, restaurantUrl, previous, current, detectedAt));
    }
    if (previous.description !== current.description) {
      changes.push(event('DESCRIPTION_CHANGED', restaurantUrl, previous, current, detectedAt));
    }
    if (previous.category !== current.category) {
      changes.push(event('CATEGORY_CHANGED', restaurantUrl, previous, current, detectedAt));
    }
    if ((previous.availability ?? null) !== (current.availability ?? null)) {
      changes.push(event('AVAILABILITY_CHANGED', restaurantUrl, previous, current, detectedAt));
    }
  }

  for (const [key, previous] of before) {
    if (!after.has(key)) changes.push(event('ITEM_REMOVED', restaurantUrl, previous, null, detectedAt));
  }
  return changes;
}

export function filterChanges(changes, {
  minimumPriceChangePercent = 0,
  keywords = [],
  eventTypes = [],
} = {}) {
  const normalizedKeywords = keywords.map((value) => normalizeText(value).toLowerCase()).filter(Boolean);
  const allowedTypes = new Set(eventTypes.filter(Boolean));
  return changes.filter((change) => {
    if (allowedTypes.size && !allowedTypes.has(change.eventType)) return false;
    if (change.eventType.startsWith('PRICE_')
      && Math.abs(change.priceChangePercent ?? 0) < minimumPriceChangePercent) return false;
    if (normalizedKeywords.length) {
      const haystack = `${change.itemName} ${change.category} ${change.current?.description ?? change.previous?.description ?? ''}`.toLowerCase();
      if (!normalizedKeywords.some((keyword) => haystack.includes(keyword))) return false;
    }
    return true;
  });
}

export function stateKey(url) {
  return `MENU_${sha256(canonicalizeUrl(url)).slice(0, 32)}`;
}

export function storeName(monitorKey) {
  return `menu-shift-${monitorKey.slice(0, 36)}-${sha256(monitorKey).slice(0, 8)}`;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diffMenus,
  extractEmbeddedJsonMenus,
  extractJsonLdMenus,
  filterChanges,
  normalizePrice,
} from '../src/lib/menu.js';
import { extractRenderedTextMenu } from '../src/lib/html-menu.js';

test('extracts nested MenuSection and MenuItem JSON-LD', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Menu',
    hasMenuSection: [{
      '@type': 'MenuSection',
      name: 'Lunch',
      hasMenuItem: [{
        '@type': 'MenuItem',
        name: 'Tomato Soup',
        description: 'Roasted tomato and basil',
        offers: { '@type': 'Offer', price: '8.50', priceCurrency: 'CAD' },
      }],
    }],
  })}</script>`;
  assert.deepEqual(extractJsonLdMenus(html), [{
    name: 'Tomato Soup',
    description: 'Roasted tomato and basil',
    category: 'Lunch',
    priceCents: 850,
    currency: 'CAD',
    availability: null,
    sourceId: '',
    sourceUrl: null,
    source: 'json-ld',
  }]);
});

test('normalizes decimal-comma prices', () => {
  assert.deepEqual(normalizePrice('€12,90', 'EUR'), { priceCents: 1290, currency: 'EUR' });
  assert.deepEqual(normalizePrice('$1,299.95', 'USD'), { priceCents: 129995, currency: 'USD' });
  assert.deepEqual(normalizePrice('1.299,95 €', 'EUR'), { priceCents: 129995, currency: 'EUR' });
});

test('extracts likely menu items from public application state', () => {
  const html = `<script type="application/json">${JSON.stringify({
    menu: {
      sectionName: 'Breakfast',
      items: [{ id: 'egg-1', name: 'Egg Sandwich', priceCents: 895, soldOut: false }],
    },
  })}</script>`;
  assert.deepEqual(extractEmbeddedJsonMenus(html, 'CAD'), [{
    name: 'Egg Sandwich',
    description: '',
    category: 'Breakfast',
    priceCents: 895,
    currency: 'CAD',
    availability: 'AVAILABLE',
    sourceId: 'egg-1',
    sourceUrl: null,
    source: 'embedded-json',
  }]);
});

test('extracts menu items from rendered ordering buttons', () => {
  const html = `<section><h2>Sandwiches</h2><button data-testid="menu-item-1"><h3>Turkey Club</h3><p>Turkey, bacon, lettuce</p><span>$14.95</span></button></section>`;
  const items = extractRenderedTextMenu(html, 'USD');
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Turkey Club');
  assert.equal(items[0].priceCents, 1495);
  assert.equal(items[0].category, 'Sandwiches');
  assert.equal(items[0].source, 'rendered-text');
});

test('emits price, description, category, add and remove events', () => {
  const before = [
    { name: 'Burger', description: 'Classic', category: 'Mains', priceCents: 1000, currency: 'USD' },
    { name: 'Old Pie', description: '', category: 'Dessert', priceCents: 500, currency: 'USD' },
    { name: 'Soup', description: 'Daily', category: 'Lunch', priceCents: 700, currency: 'USD' },
  ];
  const after = [
    { name: 'Burger', description: 'Now with pickles', category: 'Mains', priceCents: 1200, currency: 'USD' },
    { name: 'New Pie', description: '', category: 'Dessert', priceCents: 600, currency: 'USD' },
    { name: 'Soup', description: 'Daily', category: 'Starters', priceCents: 700, currency: 'USD' },
  ];
  const types = diffMenus(before, after, 'https://example.com/menu', '2026-09-03T00:00:00.000Z')
    .map((event) => event.eventType)
    .sort();
  assert.deepEqual(types, ['CATEGORY_CHANGED', 'DESCRIPTION_CHANGED', 'ITEM_ADDED', 'ITEM_REMOVED', 'PRICE_UP']);
});

test('price change includes percentage delta', () => {
  const [change] = diffMenus(
    [{ name: 'Tea', description: '', category: '', priceCents: 400, currency: 'USD' }],
    [{ name: 'Tea', description: '', category: '', priceCents: 500, currency: 'USD' }],
    'https://example.com/menu',
  );
  assert.equal(change.priceChangePercent, 25);
});

test('detects availability changes and filters insignificant price noise', () => {
  const changes = diffMenus(
    [{ name: 'Tea', description: '', category: '', priceCents: 400, currency: 'USD', availability: 'AVAILABLE' }],
    [{ name: 'Tea', description: '', category: '', priceCents: 405, currency: 'USD', availability: 'UNAVAILABLE' }],
    'https://example.com/menu',
  );
  assert.deepEqual(changes.map((change) => change.eventType), ['PRICE_UP', 'AVAILABILITY_CHANGED']);
  assert.deepEqual(
    filterChanges(changes, { minimumPriceChangePercent: 5 }).map((change) => change.eventType),
    ['AVAILABILITY_CHANGED'],
  );
});

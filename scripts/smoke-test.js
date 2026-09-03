import { readFile } from 'node:fs/promises';
import { parseMenuDocument } from '../src/lib/html-menu.js';

const urls = (await readFile(new URL('../examples/restaurant-urls.txt', import.meta.url), 'utf8'))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

const results = [];
for (const url of urls) {
  try {
    const response = await fetch(url, { headers: { 'user-agent': 'MenuShift smoke test/1.0' } });
    const html = await response.text();
    const items = response.ok ? parseMenuDocument(html) : [];
    results.push({ url, status: response.status, items: items.length, ok: items.length > 0 });
  } catch (error) {
    results.push({ url, status: null, items: 0, ok: false, error: String(error) });
  }
}

console.table(results);
const successRate = results.filter((result) => result.ok).length / Math.max(results.length, 1);
console.log(`Parse success: ${(successRate * 100).toFixed(1)}% (${results.filter((r) => r.ok).length}/${results.length})`);
process.exitCode = successRate >= 0.7 ? 0 : 1;

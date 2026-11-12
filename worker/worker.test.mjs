// node --test worker/worker.test.mjs — the Worker against a fake GitHub, catalog from library/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const merchant = JSON.parse(read('library/merchant.json'));
const { default: worker } = await import('data:text/javascript,' + encodeURIComponent(read('worker/worker.js')));

// a real purchase with a sound from the base, and a label that no pool of its item has
const real = JSON.parse(read('library/purchases.json')).purchases.find(e => e.soundId);
const itemLabels = new Set(merchant.pools.filter(p => p.items.some(([id]) => id === real.itemId)).map(p => p.label));
const wrongLabel = [...new Set(merchant.pools.map(p => p.label))].find(l => l && !itemLabels.has(l));

let base, puts;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith('https://raw.githubusercontent.com/')) return new Response(read(url.replace(/^.*?\/main\//, '')));
  if (init.method === 'PUT') { puts.push(JSON.parse(Buffer.from(JSON.parse(init.body).content, 'base64').toString())); return new Response('{}'); }
  return new Response(JSON.stringify({ sha: 'x', content: Buffer.from(base).toString('base64') }));
};
const env = ok => ({ GITHUB_TOKEN: 't', LIMITER: { limit: async () => ({ success: ok }) } });
const submit = (purchases, e = env(true)) => worker.fetch(new Request('https://w/submit', {
  method: 'POST', body: JSON.stringify({ purchases }), headers: { 'CF-Connecting-IP': '1.2.3.4' },
}), e, {});
const entry = over => ({ ...real, t: Date.now() - 1000, ...over });

test('an unreadable base is never overwritten', async () => {
  base = 'not json'; puts = [];
  assert.equal((await submit([entry({})])).status, 502);
  assert.equal(puts.length, 0);
});

test('a wrong label with a sound is dropped, the purchase is kept', async () => {
  base = JSON.stringify({ purchases: [] }); puts = [];
  const r = await (await submit([entry({ label: wrongLabel })])).json();
  assert.equal(r.added, 1);
  assert.equal(puts[0].purchases[0].label, '');
});

test('a wrong label without a sound is rejected', async () => {
  base = JSON.stringify({ purchases: [] }); puts = [];
  const r = await (await submit([entry({ label: wrongLabel, soundId: null })])).json();
  assert.equal(r.added, 0);
  assert.deepEqual(r.accepted, []);
});

test('the rate limit answers 429', async () => {
  assert.equal((await submit([entry({})], env(false))).status, 429);
});

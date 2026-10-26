// PB-4 / G20 test: an upstream failure serves the last-good document
// instead of throwing (which the API turned into a 502 for /v1/pricing,
// /v1/content and /v1/faq). Run from the repo root:
//   node --test tests/content-cache.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { loadContent, resetContentCache } from '../packages/platform/src/content.ts';

const DOC = JSON.stringify({
  schemaVersion: 1, source: 'test', site: { name: 'ElectroHire', nav: [], categories: [] },
  fees: { clientFeePct: 10, freelancerFeePct: 5, sparksPerBid: 5, identityVerification: 'x', example: { bid: 1000, clientPays: 1100, engineerReceives: 950 } },
  entities: [], orgSameAs: [], faqs: {}, pods: {}, ukHub: { currency: 'GBP', tiers: [] },
  services: { categories: [], pages: [] }, estimator: { costs: {}, typeMultipliers: {}, stageMultipliers: {}, largeRun: {}, timeline: {}, assumptions: [] },
});

test('upstream failure after a good fetch serves last-good, not an error', async (t) => {
  let fail = false;
  const server = createServer((req, res) => {
    if (fail) { res.writeHead(502); res.end('bad gateway'); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(DOC);
  });
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/content/v1.json`;
  const first = await loadContent({ CONTENT_SOURCE_URL: url });
  assert.equal(first.fees.clientFeePct, 10);
  fail = true;
  resetContentCache(); // drop the fast cache; the last-good copy must survive
  const second = await loadContent({ CONTENT_SOURCE_URL: url });
  assert.equal(second.fees.clientFeePct, 10);
});

test('upstream failure with no good copy anywhere still throws (fresh process)', async () => {
  const code = `
    import { loadContent } from '../packages/platform/src/content.ts';
    try { await loadContent({ CONTENT_SOURCE_URL: 'http://127.0.0.1:9/content/v1.json' }); console.log('NO-THROW'); }
    catch (e) { console.log('THREW'); }
  `;
  const out = await new Promise((resolve, reject) => {
    execFile(process.execPath, ['--input-type=module', '-e', code], { cwd: new URL('.', import.meta.url).pathname }, (err, stdout) => err ? reject(err) : resolve(stdout));
  });
  assert.match(out, /THREW/);
});

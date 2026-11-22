import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { search } from '../src/search.ts';

const root = fileURLToPath(new URL('../fixtures/', import.meta.url));
const query = { terms: ['写本', 'manuscripts'], era: 'medieval', region: 'Dunhuang' };

test('固定目录响应：多语、时空限定、拒绝缺失标识、跨源去重与稳定排序', async () => {
  const samples = JSON.parse(await readFile(new URL('../fixtures/search-synthetic.json', import.meta.url), 'utf8'));
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === 'archive.org') {
      assert.match(url.searchParams.get('q')!, /mediatype:texts AND "(写本|manuscripts)" AND "medieval" AND "Dunhuang"/);
      return Response.json(samples.archive);
    }
    assert.equal(url.hostname, 'api.crossref.org');
    assert.equal(url.searchParams.get('filter'), 'type:journal-article');
    assert.match(url.searchParams.get('query.bibliographic')!, /^(写本|manuscripts) medieval Dunhuang$/);
    return Response.json(samples.crossref);
  };
  const report = await search(query, { fetcher });
  assert.equal(report.queries.length, 4);
  assert.deepEqual(report.results.map(h => h.document.source_doc_id), ['doi:10.9999/fixture', 'doi:10.9999/other']);
  assert.deepEqual(report.errors.map(e => e.code), ['REJECTED', 'REJECTED']);
  assert.equal(report.results[0]?.origins.length, 4);
  for (const h of report.results) {
    assert.equal(h.basis, 'metadata_only');
    assert.equal(h.document.credibility_tier, 'T3_GENERAL_ENCYCLOPEDIA');
    assert.equal(h.document.file_sha256, undefined);
    for (const o of h.origins) assert.match(o.metadata_sha256!, /^[0-9a-f]{64}$/);
  }
  const replay = await search(query, { fetcher });
  assert.deepEqual(replay.results.map(h => h.origins), report.results.map(h => h.origins));
});

test('本地只读清单：相同内容单一 ID、保留路径、拒绝越界，未列出时零结果', async () => {
  const name = 'search-local.txt', bytes = await readFile(new URL('../fixtures/search-local.txt', import.meta.url));
  const run = (files: string[]) => search(query, { providers: ['local'], corpus: { root, files } });
  assert.equal((await run([])).queries.length, 0);
  const report = await run([name, name, '../test/search.test.ts', 'missing.txt', 'search-synthetic.json']);
  assert.equal(report.results.length, 1);
  assert.equal(report.queries.length, 4);
  assert.deepEqual(report.errors.map(e => e.code), ['LOCAL', 'LOCAL', 'LOCAL']);
  const h = report.results[0]!;
  assert.equal(h.basis, 'local_text');
  assert.equal(h.document.source_doc_id, 'sha256:' + createHash('sha256').update(bytes).digest('hex'));
  assert.equal(h.document.credibility_tier, 'T3_GENERAL_ENCYCLOPEDIA');
  assert.match(h.document.source_url!, /^file:/);
  assert.equal((await run([name])).results[0]?.document.source_doc_id, h.document.source_doc_id);
  assert.equal((await search({ terms: ['不匹配'] }, { providers: ['local'], corpus: { root, files: [name] } })).results.length, 0);
});

test('失败隔离：限流、结构错误、非 JSON、断网和超时分别留痕', async () => {
  const fetcher: typeof fetch = async (input, init) => {
    const q = new URL(String(input)).searchParams.get('query.bibliographic');
    if (q === '限流') return new Response(null, { status: 429 });
    if (q === '结构') return Response.json({});
    if (q === '坏包') return new Response('<html>');
    if (q === '断网') throw new Error('offline');
    if (q === '时限') await delay(1000, undefined, { signal: init!.signal! });
    return Response.json({ message: { items: [{ DOI: '10.9999/test', title: ['合成结果'] }] } });
  };
  const r = await search({ terms: ['限流', '结构', '坏包', '断网', '时限', '正常'] }, { providers: ['crossref'], fetcher, timeoutMs: 50 });
  assert.deepEqual(r.errors.map(e => e.code), ['HTTP', 'INVALID_RESPONSE', 'INVALID_RESPONSE', 'NETWORK', 'TIMEOUT']);
  assert.match(r.errors[0]!.message, /429/);
  assert.equal(r.results.length, 1);
  r.errors.forEach(e => assert.ok(e.url.includes('api.crossref.org') && e.query));
});

test('拒绝空查询、无授权清单与无效限制', async () => {
  await assert.rejects(search({ terms: [' '] }));
  await assert.rejects(search(query, { providers: ['local'] }));
  await assert.rejects(search(query, { limit: 0 }));
  await assert.rejects(search(query, { timeoutMs: -1 }));
});

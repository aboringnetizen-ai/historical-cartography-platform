import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHistoricalTimestamp } from '@historical-cartography/shared-schema';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspectOcrEnvironment } from '../src/ocr.ts';

const entry = fileURLToPath(new URL('../src/mcp.ts', import.meta.url));
const root = fileURLToPath(new URL('../fixtures/', import.meta.url));
const config = { root, files: { book: 'search-local.txt' }, providers: ['local'] };
const message = (method: string, id?: number | string, params?: unknown) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
const init = message('initialize', 1, { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: '测试客户端', version: '1' } });
const ready = [init, message('notifications/initialized')];
const call = (id: number, name: string, args: unknown) => message('tools/call', id, { name, arguments: args });
const ingest = 'ingest_and_ocr_document', search = 'search_historical_sources';

async function session(lines: string[], startup: unknown = config, dbPath='', catalog:unknown={}) {
  const child = spawn(process.execPath, [entry], { env: { ...process.env, SCHOLAR_EVENT_DB: dbPath, SCHOLAR_CATALOG_JSON:JSON.stringify(catalog), SCHOLAR_MCP_CONFIG: JSON.stringify(startup) }, stdio: 'pipe', timeout: 20000 });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const closed = once(child, 'close');
  child.stdin.end(lines.join('\r\n') + '\n');
  const [code] = await closed;
  return { code, stderr, replies: stdout.trimEnd() ? stdout.trimEnd().split('\n').map(line => JSON.parse(line)) : [] };
}

test('真实 stdio：初始化、无响应通知、发现工具、错误帧恢复及请求 ID', async () => {
  const { code, stderr, replies: r } = await session([
    '{', '[]', message('tools/list', 0), init, message('tools/list', 2), message('notifications/initialized'),
    message('notifications/unknown'), message('ping', '活跃'), ' '.repeat(65537), message('tools/list', 3), message('other', 4), call(5, 'chase_citations', {}),
  ]);
  assert.equal(code, 0, stderr);
  assert.deepEqual(r.map(x => x.id), [null, null, 0, 1, 2, '活跃', null, 3, 4, 5]);
  assert.deepEqual(r.map(x => x.error?.code ?? 0), [-32700, -32600, -32002, 0, -32002, 0, -32600, 0, -32601, -32602]);
  assert.equal(r[3].result.protocolVersion, '2025-03-26');
  assert.deepEqual(r[3].result.capabilities, { tools: {} });
  assert.deepEqual(r[5].result, {});
  assert.deepEqual(r[7].result.tools.map((x: { name: string }) => x.name), [search, ingest]);
});

test('授权文本：检索命中与空结果、页行及哈希都来自真实文件', async () => {
  const bytes = await readFile(resolve(root, config.files.book));
  const hash = createHash('sha256').update(bytes).digest('hex');
  const { code, stderr, replies } = await session([...ready, call(2, search, { terms: ['写本'], limit: 1 }), call(3, ingest, { file_id: 'book' }), call(4, search, { terms: ['不存在的检索词'] })]);
  assert.equal(code, 0, stderr);
  const [hits, index, miss] = replies.slice(1).map(x => JSON.parse(x.result.content[0].text));
  assert.equal(hits.results.length, 1);
  assert.equal(hits.results[0].basis, 'local_text');
  assert.equal(hits.results[0].file_id, 'book');
  assert.equal(hits.results[0].document.file_sha256, hash);
  assert.equal(index.source_sha256, hash);
  assert.equal(index.engine, 'NATIVE_TEXT');
  assert.equal(index.pages[0].lines[0].text, bytes.toString('utf8').split(/\r?\n/)[0]);
  assert.deepEqual(miss.results, []);
  assert.deepEqual(miss.errors, []);
});

test('只接受清单文件号；拒绝路径、显式 URL、可执行文件、审阅字段及检索配置覆盖', async () => {
  const invalid = [
    ...['unknown', '../fixtures/search-synthetic.json', resolve(root, config.files.book), config.files.book, '__proto__', 'constructor'].map(file_id => ({ file_id })),
    ...['path', 'local_path', 'url', 'executable', 'primary_review', 'credibility_tier'].map(k => ({ file_id: 'book', [k]: k === 'url' ? 'https://example.invalid/file' : 'T1_PRIMARY_AND_LOCAL_ACADEMIC' })),
  ];
  const badSearch = [{ terms: [] }, { terms: ['   '] }, { terms: ['x'], limit: 51 }, ...['url', 'corpus', 'files', 'providers', 'root'].map(k => ({ terms: ['x'], [k]: 'other' }))];
  const { code, stderr, replies } = await session([...ready, ...invalid.map((x, i) => call(10 + i, ingest, x)), ...badSearch.map((x, i) => call(100 + i, search, x))]);
  assert.equal(code, 0, stderr);
  assert.equal(replies.length, 1 + invalid.length + badSearch.length);
  for (const reply of replies.slice(1)) assert.equal(reply.error?.code, -32602);
  const empty = await session([...ready, call(2, ingest, { file_id: 'book' })], {});
  assert.equal(empty.replies[1].error.code, -32602);
});

test('持久库显式启用后，已授权文献能登记候选事件但不能冒充 T1', async t => {
  const dir=await mkdtemp(resolve(tmpdir(),'scholar-mcp-test-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const db=resolve(dir,'events.sqlite');
  const probe=await session([...ready,call(2,ingest,{file_id:'book'})],config,db);
  const index=JSON.parse(probe.replies[1].result.content[0].text);
  const tier='T3_GENERAL_ENCYCLOPEDIA'; const event={hist_event_id:'test',title:'工程样本',summary:'测试',event_category:'OTHER',time_start:createHistoricalTimestamp({astronomical_year:1}),involved_polity_ids:[],involved_figure_ids:[],involved_toponym_ids:[],spatial_impact_description:'无',citations:[{citation_id:'line',source_doc_id:'book',credibility_tier:tier,page_number:'file:1',ocr_line_range:[1,1],verbatim_quote:'合成检索夹具',verified_by_human:false}],highest_credibility_tier:tier,conflict_status:'CONSENSUS'};
  const args={event,index_revisions:{book:index.index_revision}};
  const run=await session([...ready,call(2,ingest,{file_id:'book'}),call(3,'register_historical_event',args),call(4,'register_historical_event',{...args,event:{...event,citations:[{...event.citations[0],credibility_tier:'T1_PRIMARY_AND_LOCAL_ACADEMIC'}]}})],config,db);
  const data=(n:number)=>JSON.parse(run.replies[n].result.content[0].text);assert.equal(data(2).stored,true);assert.equal(data(2).result.status,'PENDING_REVIEW');assert.equal(data(3).stored,false);
});

test('五项工具端到端：检索、编目、脚注候选、实文摄入、事件登记及版本失配', async t=>{
  const dir=await mkdtemp(resolve(tmpdir(),'scholar-e2e-')); t.after(()=>rm(dir,{recursive:true,force:true})); const db=resolve(dir,'repo.sqlite');
  const cfg={root,files:{voyage:'voyage-excerpt.txt',blocked:'search-local.txt'},providers:['local']};
  const catalog={voyage:{kind:'primary',source:'PG 944',bibliographic_id:'Ch. I, transcription lines 159–161',review_basis:'Eyewitness account in pinned digital transcription, not a facsimile.',reviewed_sha256:'2b22332de5962857216b522f16821c827e9c132252a00b144864368aa1d81b3b'},lead:{kind:'encyclopedia',source:'Engineering fixture',bibliographic_id:'test-only',references:[{to:'voyage',locator:'fixture:1',excerpt:'Ch. I'}]},blocked:{kind:'unverified',source:'unknown',bibliographic_id:'fixture'}};
  const run=(messages:string[], cat:unknown=catalog)=>session([...ready,...messages],cfg,db,cat);
  const content=(r:{result:{content:{text:string}[]}})=>JSON.parse(r.result.content[0]!.text);
  const probe=await run([message('tools/list',2),call(3,search,{terms:['Porto Praya']}),call(4,'classify_and_filter_sources',{source_id:'voyage'}),call(5,'chase_citations',{source_id:'lead'}),call(6,ingest,{file_id:'voyage'}),call(7,ingest,{file_id:'blocked'})]);
  assert.equal(probe.code,0,probe.stderr);const r=probe.replies;assert.equal(r[1].result.tools.length,5);assert.equal(content(r[2]).results[0].file_id,'voyage');assert.equal(content(r[3]).tier,'T1_PRIMARY_AND_LOCAL_ACADEMIC');assert.deepEqual(content(r[4]).primary_candidates,['voyage']);assert.equal(r[6].result.isError,true);
  const rev=content(r[5]).index_revision;const tier='T1_PRIMARY_AND_LOCAL_ACADEMIC';const event={hist_event_id:'1832-port',title:'Porto Praya',summary:'达尔文在航行日记中记载停泊',event_category:'OTHER',time_start:createHistoricalTimestamp({astronomical_year:1832,month:1,day:16}),involved_polity_ids:[],involved_figure_ids:[],involved_toponym_ids:['Porto Praya'],spatial_impact_description:'地名见证，非疆域定论',citations:[{citation_id:'c',source_doc_id:'voyage',credibility_tier:tier,page_number:'file:1',ocr_line_range:[1,2],verbatim_quote:'On the 16th of January, 1832, we anchored at Porto Praya',verified_by_human:false}],highest_credibility_tier:tier,conflict_status:'CONSENSUS'};
  const good=await run([call(1,ingest,{file_id:'voyage'}),call(2,'register_historical_event',{event,index_revisions:{voyage:rev}})]);assert.equal(content(good.replies[2]).result.status,'VERIFIED');
  const wrong=await run([call(1,ingest,{file_id:'voyage'})],{...catalog,voyage:{...catalog.voyage,reviewed_sha256:'f'.repeat(64)}});assert.equal(wrong.replies[1].result.isError,true);
});

test('配置越界时拒绝启动，不回落到扫描目录', async () => {
  const result = await session([], { ...config, files: { other: '../src/mcp.ts' } });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /根目录/);
  assert.deepEqual(result.replies, []);
});

test('真实英文图像 OCR，仅在 Tesseract 与 eng 可用时验证识别结果', async t => {
  let env;
  try { env = await inspectOcrEnvironment(); }
  catch (e) { if (e instanceof Error && e.message.includes('未找到可执行的 Tesseract')) return t.skip(e.message); throw e; }
  if (!env.languages.includes('eng')) return t.skip('未安装 eng 模型');
  const { code, stderr, replies } = await session([...ready, call(2, ingest, { file_id: 'scan' })], { root, files: { scan: { path: 'ocr-caption.png', route: 'map-caption', languages: ['eng'] } } });
  assert.equal(code, 0, stderr);
  const result = replies[1].result;
  assert.ok(!result.isError, result.content[0].text);
  const sidecar = JSON.parse(result.content[0].text);
  assert.equal(sidecar.source_sha256, createHash('sha256').update(await readFile(resolve(root, 'ocr-caption.png'))).digest('hex'));
  assert.match(sidecar.engine, /^tesseract/i);
  assert.deepEqual(sidecar.pages[0].lines.map((l: { text: string }) => l.text), ['PLATE 12', 'SCALE 100']);
});

import { once } from 'node:events';
import { realpath, stat, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { EvidenceStore } from './evidence.ts';
import { ScholarEvents } from './events.ts';
import { classification, chase, type CatalogEntry } from './catalog.ts';
import type { HistoricalEvent, SourceDocument } from '@historical-cartography/shared-schema';
import { runOcr, type OcrRoute } from './ocr.ts';
import { search, type SearchOptions } from './search.ts';

// 启动环境示例：SCHOLAR_MCP_CONFIG={"root":"/srv/books","files":{"book":"book.txt"},"providers":["local"]}
// 图像条目使用 {"path":"scan.png","route":"map-caption","languages":["eng"]}。根目录及内容由服务端管理。
type Obj = Record<string, unknown>;
class Invalid extends Error {}
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Invalid(message); }
function object(v: unknown): v is Obj { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function fields(v: unknown, allowed: string[]): asserts v is Obj {
  check(object(v) && Object.keys(v).every(k => allowed.includes(k)), '需要对象，且不得包含未声明的字段');
}
function word(v: unknown): v is string { return typeof v === 'string' && !!v.trim() && v.length <= 256; }
const routes: OcrRoute[] = ['vertical-classic', 'horizontal-edition', 'multilingual-paper', 'map-caption'];
type Entry = { name: string; route?: OcrRoute; languages?: string[] };
async function configuration() {
  const c: unknown = JSON.parse(process.env.SCHOLAR_MCP_CONFIG ?? '{}');
  fields(c, ['root', 'files', 'providers']);
  const files = new Map<string, Entry>();
  const entries = c.files === undefined ? {} : c.files;
  check(object(entries), 'files 必须是文件号到文件条目的映射');
  check(c.root === undefined || (typeof c.root === 'string' && isAbsolute(c.root)), 'root 必须是绝对目录');
  const root = typeof c.root === 'string' ? await realpath(c.root) : undefined;
  for (const [id, raw] of Object.entries(entries)) {
    const e = typeof raw === 'string' ? { path: raw } : raw;
    fields(e, ['path', 'route', 'languages']);
    check(root && /^[A-Za-z0-9_-]{1,80}$/.test(id) && typeof e.path === 'string' && !isAbsolute(e.path), '文件号、根目录或相对路径无效');
    const path = resolve(root, e.path), name = relative(root, path);
    check(name && name !== '..' && !name.startsWith('..' + sep) && !isAbsolute(name) && relative(path, await realpath(path)) === '' && (await stat(path)).isFile(), '清单条目必须是根目录内的普通文件，不得经过链接');
    if (e.route === undefined) {
      check(/\.(txt|md)$/i.test(name) && e.languages === undefined, '原生文本仅支持 txt/md；图像需指定 OCR 路由');
      files.set(id, { name });
    } else {
      const route = routes.find(r => r === e.route);
      check(route && (e.languages === undefined || (Array.isArray(e.languages) && e.languages.length && e.languages.every(word))), 'OCR 配置无效');
      files.set(id, { name, route, ...(e.languages && { languages: e.languages as string[] }) });
    }
  }
  const options: SearchOptions = {};
  if (root) options.corpus = { root, files: [...files.values()].filter(e => !e.route).map(e => e.name) };
  if (c.providers !== undefined) {
    check(Array.isArray(c.providers) && c.providers.length > 0 && c.providers.every(p => p === 'archive' || p === 'crossref' || (root && p === 'local')), '检索来源配置无效');
    options.providers = c.providers;
  }
  return { root, files, options };
}

const stringSchema = { type: 'string', minLength: 1, maxLength: 256 };
const tools = [
  { name: 'search_historical_sources', description: '检索启动配置选定的来源，区分本地文本与远端元数据，保留失败记录。', inputSchema: {
    type: 'object', additionalProperties: false, required: ['terms'], properties: { terms: { type: 'array', items: stringSchema, minItems: 1, maxItems: 12 }, era: stringSchema, region: stringSchema, limit: { type: 'integer', minimum: 1, maximum: 50 } } } },
  { name: 'ingest_and_ocr_document', description: '按授权文件号读取原生文本页行或对配置的原图执行 OCR；不进行一级来源审阅。', inputSchema: {
    type: 'object', additionalProperties: false, required: ['file_id'], properties: { file_id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' } } } },
];
async function serve() {
  const { root, files, options } = await configuration();
  const store = new EvidenceStore();
  // Only the process operator can opt into a persistent candidate-event database.
  const dbPath = process.env.SCHOLAR_EVENT_DB;
  check(!dbPath || isAbsolute(dbPath), '事件库需要服务端配置的绝对路径');
  const events = dbPath ? new ScholarEvents(dbPath, store) : undefined;
  const availableTools: Array<{name:string; description:string; inputSchema:unknown}> = [...tools];
  const rawCatalog:unknown=JSON.parse(process.env.SCHOLAR_CATALOG_JSON || '{}');
  check(object(rawCatalog),'编目配置无效');
  const catalog=new Map<string,CatalogEntry>();
  for(const [id,e] of Object.entries(rawCatalog)){
    fields(e,['kind','source','bibliographic_id','review_basis','reviewed_sha256','references']);
    check(word(id) && typeof e.kind==='string' && ['primary','scholarship','review','encyclopedia','unverified'].includes(e.kind) && word(e.source) && word(e.bibliographic_id),'文献编目条目无效');
    check((e.review_basis===undefined||word(e.review_basis)) && (e.reviewed_sha256===undefined || typeof e.reviewed_sha256==='string' && /^[a-f0-9]{64}$/.test(e.reviewed_sha256)) && (e.references===undefined || Array.isArray(e.references) && e.references.every(r=>object(r)&&word(r.to)&&word(r.locator)&&word(r.excerpt))),'审阅字段或脚注缺少来源定位');
    catalog.set(id,e as unknown as CatalogEntry);
  }
  if(catalog.size) for(const name of ['classify_and_filter_sources','chase_citations']) availableTools.push({name,description:name==='chase_citations'?'沿启动编目已登记的脚注定位候选一级来源；不代替引文核验。':'按已审阅编目返回采信等级并指明是否拒绝。',inputSchema:{type:'object',additionalProperties:false,required:['source_id'],properties:{source_id:stringSchema}}});
  if (events) availableTools.push({name:'register_historical_event',description:'用已摄入的页行及固定索引登记候选事件；不提升来源等级，不授予空间提交权限。',inputSchema:{type:'object',additionalProperties:false,required:['event','index_revisions'],properties:{event:{type:'object'},index_revisions:{type:'object',additionalProperties:{type:'string',pattern:'^[0-9a-f]{64}$'}},parent_revision:{type:'string',pattern:'^[0-9a-f]{64}$'}}}});
  let artifacts: string | undefined;
  async function call(name: string, a: unknown) {
    if (name === 'search_historical_sources') {
      fields(a, ['terms', 'era', 'region', 'limit']);
      check(Array.isArray(a.terms) && a.terms.length >= 1 && a.terms.length <= 12 && a.terms.every(word), '需要 1–12 个有效检索词');
      check((a.era === undefined || word(a.era)) && (a.region === undefined || word(a.region)), '时代或区域无效');
      check(a.limit === undefined || (typeof a.limit === 'number' && Number.isInteger(a.limit) && a.limit >= 1 && a.limit <= 50), 'limit 必须为 1–50 的整数');
      if (root && relative(root, await realpath(root)) !== '') throw new Error('授权目录已被替换为链接');
      const found = await search({ terms: a.terms, ...(a.era && { era: a.era }), ...(a.region && { region: a.region }) }, { ...options, ...(a.limit && { limit: a.limit }) });
      // 本地命中可直接接续摄入；远端元数据不是已授权的本地文件。
      const ids = new Map([...files].filter(([, e]) => !e.route).map(([id, e]) => [e.name, id]));
      return { ...found, results: found.results.map(hit => hit.basis === 'local_text' ? { ...hit, file_id: ids.get(hit.document.title) } : hit) };
    }
    if (name==='classify_and_filter_sources' || name==='chase_citations') {
      fields(a,['source_id']);check(word(a.source_id) && catalog.has(a.source_id),'未知编目号');
      if(name==='chase_citations')return chase(catalog,a.source_id);
      const result=classification(catalog.get(a.source_id)!);return {...result,source_id:a.source_id,excluded:result.tier==='REJECTED_UNVERIFIED'};
    }
    if (name === 'register_historical_event' && events) {
      fields(a,['event','index_revisions','parent_revision']);
      check(object(a.event) && object(a.index_revisions) && Object.values(a.index_revisions).every(v=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v)), '事件或修订映射无效');
      check(a.parent_revision===undefined || (typeof a.parent_revision==='string' && /^[a-f0-9]{64}$/.test(a.parent_revision)), '无效父版本');
      fields(a.event,['hist_event_id','title','summary','event_category','time_start','time_end','involved_polity_ids','involved_figure_ids','involved_toponym_ids','spatial_impact_description','citations','highest_credibility_tier','conflict_status']);
      return events.register(a.event as unknown as HistoricalEvent,a.index_revisions as Record<string,string>,a.parent_revision??null);
    }
    fields(a, ['file_id']);
    const entry = typeof a.file_id === 'string' ? files.get(a.file_id) : undefined;
    check(root && entry && typeof a.file_id === 'string', '文件号未授权');
    const path = resolve(root, entry.name);
    if (relative(path, await realpath(path)) !== '' || !(await stat(path)).isFile()) throw new Error('授权文件已移动或被替换为链接');
    const catalogEntry = catalog.get(a.file_id);
    const tier = catalogEntry ? classification(catalogEntry).tier : 'T3_GENERAL_ENCYCLOPEDIA';
    if (tier === 'REJECTED_UNVERIFIED') throw Error('拒绝级文献不能摄入');
    const review = tier === 'T1_PRIMARY_AND_LOCAL_ACADEMIC' && catalogEntry ? {file_sha256:catalogEntry.reviewed_sha256!,basis:catalogEntry.review_basis!} : undefined;
    const doc:SourceDocument = {source_doc_id:a.file_id, local_path:path, medium:'LOCAL_FILE',title:entry.name,language:'und',authors:[],credibility_tier:tier,is_local_academic_journal:false,ocr_indexed:false,...(review && {file_sha256:review.file_sha256})};
    if (entry.route) {
      const side = await runOcr(path, {route:entry.route,...(entry.languages && {languages:entry.languages})});
      const data=JSON.stringify(side); artifacts ??= await mkdtemp(resolve(tmpdir(),'scholar-sidecars-'));
      const name=resolve(artifacts,createHash('sha256').update(data).digest('hex')+'.json');
      await writeFile(name,data);
      const index=await store.indexOcrFile(doc,name,review);
      return {file_id:a.file_id,...side,index_revision:index.index_revision};
    }
    const index = await store.indexNativeFile(doc,undefined,review);
    return { file_id: a.file_id, source_sha256: index.document.file_sha256, index_revision: index.index_revision, engine: index.engine, pages: index.pages };
  }
  let state: 'new' | 'initializing' | 'ready' = 'new';
  const version = '2025-03-26';
  const error = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
  async function handle(line: string) {
    let m: unknown;
    try { m = JSON.parse(line); } catch { return error(null, -32700, 'JSON 解析失败'); }
    if (!object(m) || m.jsonrpc !== '2.0' || typeof m.method !== 'string' || ('id' in m && typeof m.id !== 'string' && !Number.isSafeInteger(m.id))) return error(null, -32600, '无效的 JSON-RPC 请求');
    const p = m.params === undefined ? {} : m.params;
    if (!('id' in m)) {
      if (state === 'initializing' && m.method === 'notifications/initialized' && object(p)) state = 'ready';
      return;
    }
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id: m.id, result });
    try {
      check(object(p), 'params 必须是对象');
      if (m.method === 'ping') return ok({});
      if (m.method === 'initialize') {
        check(state === 'new' && word(p.protocolVersion) && object(p.capabilities) && object(p.clientInfo) && word(p.clientInfo.name) && word(p.clientInfo.version), '初始化参数或状态无效');
        state = 'initializing';
        return ok({ protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: 'scholar-agent', version: '0.1.0' } });
      }
      if (state !== 'ready') return error(m.id, -32002, '尚未完成初始化');
      if (m.method === 'tools/list') { fields(p, ['_meta']); return ok({ tools: availableTools }); }
      if (m.method !== 'tools/call') return error(m.id, -32601, '未知方法');
      fields(p, ['name', 'arguments', '_meta']);
      check(typeof p.name === 'string' && availableTools.some(t => t.name === p.name), '未知工具');
      try {
        const data = await call(p.name, p.arguments);
        return ok({ content: [{ type: 'text', text: JSON.stringify(data) }] });
      } catch (e) {
        if (e instanceof Invalid) throw e;
        return ok({ isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : '工具执行失败' }] });
      }
    } catch (e) { return error(m.id, -32602, e instanceof Error ? e.message : '参数无效'); }
  }
  async function send(reply: unknown) {
    if (reply !== undefined && !process.stdout.write(JSON.stringify(reply) + '\n')) await once(process.stdout, 'drain');
  }
  // 超长帧丢弃到下一换行；既不积累无限长输入，也不把后半帧当新请求。
  let pending: Buffer[] = [], size = 0;
  const max = 64 * 1024;
  async function finish() {
    if (size > max) await send(error(null, -32600, '请求行超过 64 KiB'));
    else await send(await handle(Buffer.concat(pending).toString('utf8')));
    pending = []; size = 0;
  }
  for await (const chunk of process.stdin) {
    const b = chunk as Buffer;
    for (let start = 0; start < b.length;) {
      const newline = b.indexOf(10, start), end = newline < 0 ? b.length : newline;
      size += end - start;
      if (size <= max) pending.push(b.subarray(start, end));
      if (newline < 0) break;
      await finish(); start = end + 1;
    }
  }
  if (size) await finish();
  events?.close();
  if (artifacts) await rm(artifacts,{recursive:true,force:true});
}
await serve().catch(e => { console.error(e instanceof Error ? e.message : '服务启动失败'); process.exitCode = 1; });

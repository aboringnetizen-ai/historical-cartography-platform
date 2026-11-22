import { createHash } from 'node:crypto';
import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SourceDocument } from '@historical-cartography/shared-schema';

type Provider = 'archive' | 'crossref' | 'local';
export interface SearchQuery {
  terms: readonly string[]; // 同义词或异译，任一命中即可；每个词单独提交给远端。
  era?: string; // 主题时代，不是出版日期。
  region?: string;
}
export interface SearchOptions {
  providers?: readonly Provider[]; // 默认两个远端；提供 corpus 时也查本地。
  corpus?: { root: string; files: readonly string[] }; // 调用者授权的绝对根及相对 UTF-8 文本文件清单。
  limit?: number; // 每个远端查询的行数，也是合并后最多返回的条数，默认 10，范围 1–50。
  timeoutMs?: number; // 每次远端请求含响应体的时限，默认 10000 毫秒。
  fetcher?: typeof fetch;
}
interface Trace { provider: Provider; query: string; url: string }
interface Hit {
  document: SourceDocument;
  basis: 'metadata_only' | 'local_text';
  score: number;
  origins: (Trace & { sourceUrl: string; metadata_sha256?: string })[];
}
interface Failure extends Trace { code: 'HTTP' | 'TIMEOUT' | 'NETWORK' | 'INVALID_RESPONSE' | 'REJECTED' | 'LOCAL'; message: string }
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const norm = (s: string) => s.normalize('NFKC').toLowerCase();
const strings = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).filter((s): s is string => typeof s === 'string' && !!s.trim());
function object(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
function inside(root: string, file: string) {
  const r = relative(root, file);
  return !!r && r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r);
}
function endpoint(provider: 'crossref' | 'archive', words: string[], limit: number) {
  if (provider === 'crossref') {
    const url = new URL('https://api.crossref.org/works');
    url.searchParams.set('query.bibliographic', words.join(' '));
    url.searchParams.set('filter', 'type:journal-article');
    url.searchParams.set('rows', String(limit));
    return url;
  }
  const url = new URL('https://archive.org/advancedsearch.php');
  url.searchParams.set('q', 'mediatype:texts AND ' + words.map(w => '"' + w.replace(/["\\]/g, '\\$&') + '"').join(' AND '));
  url.searchParams.set('fl[]', 'identifier,title,creator,language,subject,description,date,external-identifier');
  url.searchParams.set('rows', String(limit));
  url.searchParams.set('output', 'json');
  return url;
}

export async function search(query: SearchQuery, options: SearchOptions = {}) {
  const terms = [...new Set(query.terms.map(s => s.trim()).filter(Boolean))];
  const era = query.era?.trim(), region = query.region?.trim();
  const context = [era, region].filter((s): s is string => !!s);
  const limit = options.limit ?? 10, timeout = options.timeoutMs ?? 10000;
  if (!terms.length || terms.length > 12 || [...terms, ...context].some(w => w.length > 256)) throw new Error('需要 1–12 个检索词，每个词或时空限定最多 256 字符');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(timeout) || timeout < 1 || timeout > 2147483647) throw new Error('limit 或 timeoutMs 越界');
  const providers = new Set<Provider>(options.providers ?? (options.corpus ? ['archive', 'crossref', 'local'] : ['archive', 'crossref']));
  const corpus = options.corpus;
  if (providers.has('local') && (!corpus || !isAbsolute(corpus.root) || !Array.isArray(corpus.files))) throw new Error('本地检索必须提供授权绝对根目录和文件清单');
  const queries: Trace[] = [], errors: Failure[] = [], hits = new Map<string, Hit>();
  const timestamp = new Date().toISOString();
  function add(id: string, doc: Pick<SourceDocument, 'title' | 'authors' | 'language' | 'medium'> & Partial<SourceDocument>, url: string, text: string, trace: Trace, metadataSha256?: string) {
    const local = trace.provider === 'local', hay = norm(doc.title + '\n' + text);
    const matches = terms.filter(w => hay.includes(norm(w))).length;
    if (local && !matches) return;
    // 时代、区域优先；作者及已读文本仅用来排序，不提升证据等级。
    const score = context.filter(w => hay.includes(norm(w))).length * 20 + Math.min(matches, 4) * 2 + Number(!!doc.authors.length) + Number(local) * 2;
    const origin = { ...trace, sourceUrl: url, ...(metadataSha256 ? { metadata_sha256: metadataSha256 } : {}) };
    const existing = hits.get(id);
    if (existing) {
      if (!existing.origins.some(o => o.url === origin.url && o.sourceUrl === url)) existing.origins.push(origin);
      existing.score = Math.max(existing.score, score);
      return;
    }
    hits.set(id, { document: { ...doc, source_doc_id: id, source_url: url, credibility_tier: 'T3_GENERAL_ENCYCLOPEDIA', is_local_academic_journal: false, ocr_indexed: false, fetched_at_iso: timestamp }, basis: local ? 'local_text' : 'metadata_only', score, origins: [origin] });
  }
  for (const provider of providers) {
    if (provider === 'local') {
      if (!corpus) continue;
      for (const name of new Set(corpus.files)) {
        const trace = { provider, query: [...terms, ...context].join(' / '), url: pathToFileURL(resolve(corpus.root, name)).href };
        queries.push(trace);
        try {
          if (isAbsolute(name) || !inside(corpus.root, resolve(corpus.root, name)) || !/\.(txt|md)$/i.test(name)) throw new Error('仅允许根目录内清单列出的文本文件');
          const root = await realpath(corpus.root), path = await realpath(resolve(root, name));
          if (!inside(root, path) || relative(path, resolve(root, name)) !== '' || !(await stat(path)).isFile()) throw new Error('目标越界、经过链接或不是普通文件');
          const fd = await open(path, 'r');
          try {
            const size = (await fd.stat()).size;
            if (size > 4 * 1024 * 1024) throw new Error('文本超过 4 MiB');
            const bytes = await fd.readFile();
            if (bytes.length > 4 * 1024 * 1024) throw new Error('文本超过 4 MiB');
            const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            if (!text.trim() || text.includes('\0')) throw new Error('不是非空 UTF-8 文本');
            const digest = hash(bytes);
            add('sha256:' + digest, { title: name, authors: [], language: 'und', medium: 'LOCAL_FILE', local_path: path, file_sha256: digest }, pathToFileURL(path).href, text, trace);
          } finally { await fd.close(); }
        } catch (e) { errors.push({ ...trace, code: 'LOCAL', message: String(e) }); }
      }
      continue;
    }
    for (const term of terms) {
      const words = [term, ...context], url = endpoint(provider, words, limit);
      const trace = { provider, query: words.join(' '), url: url.href };
      queries.push(trace);
      const signal = AbortSignal.timeout(timeout);
      let stage: Failure['code'] = 'NETWORK';
      try {
        const response = await (options.fetcher ?? fetch)(url, { signal, redirect: 'error', headers: { accept: 'application/json' } });
        if (!response.ok) { await response.body?.cancel(); stage = 'HTTP'; throw new Error(`HTTP ${response.status}`); }
        const body = await response.text();
        stage = 'INVALID_RESPONSE';
        const json = object(JSON.parse(body));
        const rows: unknown = provider === 'archive' ? object(json.response).docs : object(json.message).items;
        if (!Array.isArray(rows)) throw new Error('响应缺少结果数组');
        for (const item of rows.slice(0, limit)) {
          const row = object(item), archive = provider === 'archive';
          const title = strings(row.title)[0]?.trim();
          const key = archive ? row.identifier : row.DOI;
          if (!title || typeof key !== 'string' || !(archive ? /^[a-z\d][a-z\d._-]*$/i : /^10\.\d{4,9}\/[^\s]+$/i).test(key)) {
            errors.push({ ...trace, code: 'REJECTED', message: '缺少可复核的题名或来源标识' }); continue;
          }
          const authors = archive ? strings(row.creator) : (Array.isArray(row.author) ? row.author : []).map(a => [object(a).given, object(a).family, object(a).name].flatMap(strings).join(' ')).filter(Boolean);
          const doi = archive ? strings(row['external-identifier']).map(s => s.replace(/^(?:urn:)?doi:/i, '')).find(s => /^10\.\d{4,9}\/[^\s]+$/i.test(s)) : key;
          const id = doi ? 'doi:' + doi.toLowerCase() : 'archive:' + key;
          const source = archive ? 'https://archive.org/details/' + encodeURIComponent(key) : 'https://doi.org/' + key.split('/').map(encodeURIComponent).join('/');
          const dates = object(row.published)['date-parts'];
          const year = archive ? Number(strings(row.date)[0]?.match(/^\d{4}/)?.[0]) : Array.isArray(dates) && Array.isArray(dates[0]) ? dates[0][0] : undefined;
          const publisher = strings(row['container-title'])[0] || strings(row.publisher)[0];
          add(id, { title, authors, language: strings(row.language)[0] ?? 'und', medium: archive ? 'INTERNET_ARCHIVE' : 'ACADEMIC_JOURNAL', ...(Number.isInteger(year) ? { publication_year: year } : {}), ...(publisher ? { publisher_or_journal: publisher } : {}) }, source, [row.subject, row.description, row.abstract].flatMap(strings).join(' '), trace, hash(JSON.stringify(row)));
        }
      } catch (e) { errors.push({ ...trace, code: signal.aborted ? 'TIMEOUT' : stage, message: String(e) }); }
    }
  }
  const results = [...hits.values()].sort((a, b) => b.score - a.score || a.document.source_doc_id.localeCompare(b.document.source_doc_id)).slice(0, limit);
  return { searched_at: timestamp, query: { terms, era, region }, queries, errors, results };
}

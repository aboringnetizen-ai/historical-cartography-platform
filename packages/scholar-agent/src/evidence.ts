import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { EvidenceCitation, GateIssue, SourceDocument, VerifiedCitation } from '@historical-cartography/shared-schema';

export const EVIDENCE_POLICY = 'v1:nfc-width-punctuation-whitespace:exact:ocr-min-0.90';
const T1 = 'T1_PRIMARY_AND_LOCAL_ACADEMIC';
const tiers = new Set([T1, 'T2_SECONDARY_SCHOLARLY_OR_CURATED', 'T3_GENERAL_ENCYCLOPEDIA']);
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;

export function normalizeQuote(text: string): string {
  // 只折叠全角 ASCII、空白及规范等价字符；不删否定词、标点，不做模糊匹配。
  return text.normalize('NFC').replace(/[！-～]/gu, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s+/gu, ' ').trim();
}

export interface EvidenceLine {
  line_number: number;
  text: string;
  bbox?: [number, number, number, number]; // 原始页图像素，左上为原点，[左, 上, 右, 下)。
  confidence?: number;
}
export interface EvidencePage {
  file_page: number;
  printed_page?: string;
  width?: number;
  height?: number;
  lines: EvidenceLine[];
}
export interface OcrSidecar {
  source_sha256: string;
  engine: string;
  pages: (EvidencePage & { width: number; height: number; lines: Required<EvidenceLine>[] })[];
}
// 由受信的编目/审阅端提供；不是核验请求的自报字段。必须与审阅过的文件字节绑定。
export interface PrimaryReview { file_sha256: string; basis: string }
export interface EvidenceIndex {
  document: SourceDocument & { local_path: string; file_sha256: string };
  index_revision: string;
  engine: string;
  pages: EvidencePage[];
  primary_review?: PrimaryReview;
  ocr_artifact?: { path: string; sha256: string };
}
export type CitationCheck =
  | { status: 'VERIFIED' | 'CANDIDATE'; citation: VerifiedCitation; source_sha256: string; file_page: number; lines: EvidenceLine[]; issues: GateIssue[] }
  | { status: 'REJECTED'; issues: GateIssue[] };

function checkLabel(label: string | undefined, seen: Set<string>) {
  if (label === undefined) return;
  if (typeof label !== 'string' || !label.trim() || label.trim() !== label || /^(file|print):/.test(label) || seen.has(label)) {
    throw new Error('印刷页号为空、重复或含保留前缀');
  }
  seen.add(label);
}

function importOcr(data: OcrSidecar, digest: string): EvidencePage[] {
  if (data.source_sha256 !== digest || typeof data.engine !== 'string' || !data.engine.trim() || !Array.isArray(data.pages) || !data.pages.length) {
    throw new Error('OCR 缺少引擎、页面或源文件哈希不符');
  }
  const labels = new Set<string>();
  return data.pages.map((page, p) => {
    if (page.file_page !== p + 1 || !positive(page.width) || !positive(page.height) || !Array.isArray(page.lines)) throw new Error('OCR 文件页序或原图尺寸无效');
    checkLabel(page.printed_page, labels);
    const lines = page.lines.map((line, l) => {
      if (line.line_number !== l + 1 || typeof line.text !== 'string' || !line.text.trim() || /[\r\n\f]/.test(line.text) ||
          typeof line.confidence !== 'number' || !Number.isFinite(line.confidence) || line.confidence < 0 || line.confidence > 1 ||
          !Array.isArray(line.bbox) || line.bbox.length !== 4 || !line.bbox.every(Number.isFinite)) throw new Error('OCR 行、BBox 或置信度无效');
      const [x, y, r, b] = line.bbox;
      if (x < 0 || y < 0 || x >= r || y >= b || r > page.width || b > page.height) throw new Error('OCR BBox 越界或为空');
      return { line_number: l + 1, text: line.text, bbox: line.bbox, confidence: line.confidence };
    });
    return { file_page: p + 1, width: page.width, height: page.height, ...(page.printed_page !== undefined && { printed_page: page.printed_page }), lines };
  });
}

export class EvidenceStore {
  #indexes = new Map<string, EvidenceIndex>();

  async indexNativeFile(doc: SourceDocument, printedPages?: readonly (string | null)[], review?: PrimaryReview) {
    return this.#build(doc, undefined, printedPages, review);
  }

  async indexOcrFile(doc: SourceDocument, sidecarPath: string, review?: PrimaryReview) {
    return this.#build(doc, resolve(sidecarPath), undefined, review);
  }

  async #build(input: SourceDocument, sidecar: string | undefined, labels?: readonly (string | null)[], review?: PrimaryReview): Promise<EvidenceIndex> {
    const doc = structuredClone(input);
    if (!doc.source_doc_id.trim() || !doc.local_path) throw new Error('缺少本地文件或文档标识');
    if (!tiers.has(doc.credibility_tier)) {
      this.#indexes.delete(doc.source_doc_id);
      throw new Error('拒绝级或未知来源不能入索引');
    }
    const path = resolve(doc.local_path), bytes = await readFile(path), digest = sha(bytes);
    if (doc.file_sha256 !== undefined && doc.file_sha256 !== digest) throw new Error('源文件 SHA-256 不符');
    if (review && (review.file_sha256 !== digest || !review.basis.trim())) throw new Error('一级来源审阅依据未绑定当前文件');
    let engine: string, pages: EvidencePage[], artifact: EvidenceIndex['ocr_artifact'];
    if (sidecar !== undefined) {
      const raw = await readFile(sidecar);
      const data: OcrSidecar = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      pages = importOcr(data, digest);
      engine = data.engine;
      artifact = { path: sidecar, sha256: sha(raw) };
      delete doc.ocr_engine;
      if (engine === 'PADDLE_OCR' || engine === 'SURYA' || engine === 'MINERU') doc.ocr_engine = engine;
    } else {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (/[\x00-\x08\x0e-\x1f]/u.test(text) || text.startsWith('%PDF-')) throw new Error('原生路由只接受 UTF-8 纯文本');
      const chunks = text.split('\f'), seen = new Set<string>();
      if (labels && labels.length !== chunks.length) throw new Error('印刷页映射长度与文件页数不符');
      pages = chunks.map((chunk, i) => {
        const label = labels?.[i] ?? undefined;
        checkLabel(label, seen);
        const rows = chunk.split(/\r\n|\n|\r/u);
        if (rows.at(-1) === '') rows.pop(); // 终止换行不是额外一行；保留中间空白行。
        return { file_page: i + 1, ...(label !== undefined && { printed_page: label }), lines: rows.map((text, j) => ({ line_number: j + 1, text })) };
      });
      engine = doc.ocr_engine = 'NATIVE_TEXT';
    }
    const document = { ...doc, local_path: path, file_sha256: digest, ocr_indexed: true };
    const index_revision = sha(JSON.stringify([EVIDENCE_POLICY, doc.source_doc_id, digest, doc.credibility_tier, engine, artifact?.sha256, pages.map(p => p.printed_page ?? null), review?.basis ?? null]));
    const index = { document, index_revision, engine, pages, ...(review && { primary_review: structuredClone(review) }), ...(artifact && { ocr_artifact: artifact }) };
    this.#indexes.set(doc.source_doc_id, index);
    return structuredClone(index);
  }

  async verifyCitation(input: EvidenceCitation, indexRevision: string): Promise<CitationCheck> {
    const c = structuredClone(input), idx = this.#indexes.get(c.source_doc_id);
    const issue = (code: GateIssue['code'], message: string): GateIssue => ({ gate: 'G3', code, entity_id: c.citation_id, message });
    const reject = (code: GateIssue['code'], message: string): CitationCheck => ({ status: 'REJECTED', issues: [issue(code, message)] });
    if (!idx || !indexRevision || idx.index_revision !== indexRevision || idx.document.credibility_tier !== c.credibility_tier) return reject('UNVERIFIED_SOURCE', '索引缺失、版本过期或来源等级不符');
    try {
      if (sha(await readFile(idx.document.local_path)) !== idx.document.file_sha256 || (idx.ocr_artifact && sha(await readFile(idx.ocr_artifact.path)) !== idx.ocr_artifact.sha256) || this.#indexes.get(c.source_doc_id) !== idx) {
        return reject('UNVERIFIED_SOURCE', '原件或 OCR 索引已被替换，请重新索引');
      }
    } catch { return reject('UNVERIFIED_SOURCE', '原件或 OCR 索引不可读'); }
    // file:N 只指文件顺序；print:X 或裸 X 只指显式声明的印刷页，不向别页回退。
    const locator = c.page_number, range = c.ocr_line_range;
    const page = typeof locator !== 'string' || !locator ? undefined : locator.startsWith('file:')
      ? idx.pages.find(p => `file:${p.file_page}` === locator) : idx.pages.find(p => p.printed_page === locator.replace(/^print:/u, ''));
    if (!c.citation_id?.trim() || !page || !Array.isArray(range) || range.length !== 2 || !range.every(positive) || range[0] > range[1] || range[1] > page.lines.length || c.web_section_anchor !== undefined) return reject('QUOTE_NOT_FOUND', '缺少有效的本地页行定位或不是本地引文');
    const lines = page.lines.slice(range[0] - 1, range[1]), rows = lines.map(l => normalizeQuote(l.text));
    const quote = typeof c.verbatim_quote === 'string' ? normalizeQuote(c.verbatim_quote) : '';
    const selected = normalizeQuote(rows.join(' '));
    // 允许首尾为行内摘录，但实际命中必须同时触及声明的首、末行。
    let found = false;
    if (/[\p{L}\p{N}]/u.test(quote) && rows[0] && rows.at(-1)) {
      for (let p = selected.indexOf(quote); p >= 0 && p < rows[0].length; p = selected.indexOf(quote, p + 1)) {
        if (p + quote.length > selected.length - rows.at(-1)!.length) { found = true; break; }
      }
    }
    if (!found) return reject('QUOTE_NOT_FOUND', '规范化引文未在指定页和行段精确命中');
    const issues: GateIssue[] = [];
    if (c.credibility_tier !== T1 || !idx.primary_review) issues.push(issue('PENDING_T1_VERIFICATION', '仅为候选，需独立核实一级来源及其版本'));
    if (lines.some(l => l.confidence !== undefined && l.confidence < 0.90)) issues.push(issue('PENDING_T1_VERIFICATION', 'OCR 行置信度低于 0.90，需对原图复核'));
    const citation: VerifiedCitation = { citation_id: c.citation_id, source_doc_id: c.source_doc_id, index_revision: indexRevision, evidence: { ...c, quote_match_score: 1 } };
    return { status: issues.length ? 'CANDIDATE' : 'VERIFIED', citation, source_sha256: idx.document.file_sha256, file_page: page.file_page, lines: structuredClone(lines), issues };
  }
}

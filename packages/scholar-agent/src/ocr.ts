import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EvidenceLine, OcrSidecar } from './evidence.ts';

export type OcrRoute = 'vertical-classic' | 'horizontal-edition' | 'multilingual-paper' | 'map-caption';
export interface OcrOptions {
  route: OcrRoute;
  languages?: readonly string[];
  printedPages?: readonly (string | null)[];
  executable?: string;
}

function invoke(executable: string, args: string[], input?: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(executable, args, { windowsHide: true, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(err);
      // Tesseract 可能在一个模型加载失败后仍用其余模型成功退出。
      if (/Failed loading language|Error opening data file|Error during processing/i.test(stderr)) return reject(new Error(stderr.trim()));
      resolve(stdout);
    });
    child.stdin?.on('error', e => { if ((e as NodeJS.ErrnoException).code !== 'EPIPE') reject(e); });
    child.stdin?.end(input);
  });
}

export async function inspectOcrEnvironment(executable?: string) {
  const candidates = executable ? [executable] : ['tesseract', ...(process.platform === 'win32' ? [join(process.env.ProgramFiles ?? 'C:/Program Files', 'Tesseract-OCR', 'tesseract.exe')] : [])];
  for (const path of candidates) {
    let version: string;
    try { version = (await invoke(path, ['--version'])).split(/\r?\n/)[0]!.trim(); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e; }
    if (!/^tesseract\s/i.test(version)) throw new Error('未检测到有效的 Tesseract 版本');
    const languages = (await invoke(path, ['--list-langs'])).trim().split(/\r?\n/).slice(1).map(s => s.trim()).filter(Boolean);
    return { executable: path, version, languages };
  }
  throw new Error('未找到可执行的 Tesseract；未安装或下载任何软件');
}

export function selectOcrRoute(route: OcrRoute, available: readonly string[], requested?: readonly string[]) {
  const profiles = { 'vertical-classic': [5, 'chi_tra_vert'], 'horizontal-edition': [6, 'chi_sim'], 'multilingual-paper': [3, null], 'map-caption': [11, 'chi_tra'] } as const;
  if (!Object.hasOwn(profiles, route)) throw new Error('未知 OCR 路由');
  const [psm, fallback] = profiles[route];
  const languages = [...new Set(requested ?? (fallback ? [fallback] : []))];
  if (!languages.length) throw new Error('必须显式指定原文语言模型');
  if (languages.some(l => !/^(?:script\/)?[A-Za-z][A-Za-z0-9_]*$/.test(l) || l === 'osd' || l === 'equ')) throw new Error('无效的 OCR 文字语言模型');
  if (route === 'vertical-classic' && !languages.some(l => l.endsWith('_vert'))) throw new Error('竖排路由需要竖排语言模型');
  const missing = languages.filter(l => !available.includes(l));
  if (missing.length) throw new Error(`缺少 Tesseract 语言模型：${missing.join('+')}`);
  return { route, languages, psm };
}

function parsePages(tsv: string, labels?: OcrOptions['printedPages']): OcrSidecar['pages'] {
  const rows = tsv.trimEnd().split(/\r?\n/);
  if (rows.shift() !== 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext') throw new Error('Tesseract 未返回 TSV');
  const pages: OcrSidecar['pages'] = [];
  let line: Required<EvidenceLine> | undefined, key = '';
  const seenLabels = new Set<string>();
  for (const row of rows) {
    const c = row.split('\t'), level = c[0], n = Number(c[1]);
    const [x, y, w, h] = [Number(c[6]), Number(c[7]), Number(c[8]), Number(c[9])];
    if (level === '1') {
      if (n !== pages.length + 1 || !Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) throw new Error('无效的原图页序或尺寸');
      const label = labels?.[n - 1];
      if (label != null && (!label || label !== label.trim() || /^(file|print):/.test(label) || seenLabels.has(label))) throw new Error('无效或重复的印刷页号');
      if (label != null) seenLabels.add(label);
      pages.push({ file_page: n, ...(label != null && { printed_page: label }), width: w, height: h, lines: [] });
      line = undefined;
    } else if (level === '5') {
      const page = pages.at(-1), text = c.slice(11).join(' ').trim();
      if (!text) continue;
      const conf = Number(c[10]) / 100;
      if (!page || n !== page.file_page || ![x,y,w,h].every(Number.isSafeInteger) || w <= 0 || h <= 0 || x < 0 || y < 0 || x+w > page.width || y+h > page.height || !c[10]?.trim() || !Number.isFinite(conf) || conf < 0 || conf > 1) throw new Error('无效的 OCR 词框或置信度');
      const next = c.slice(1, 5).join(':');
      if (!line || next !== key) {
        key = next;
        line = { line_number: page.lines.length + 1, text, bbox: [x,y,x+w,y+h], confidence: conf };
        page.lines.push(line);
      } else {
        const adjacentHan = /\p{Script=Han}$/u.test(line.text) && /^\p{Script=Han}/u.test(text);
        line.text += (adjacentHan ? '' : ' ') + text;
        const [l,t,r,b] = line.bbox;
        line.bbox = [Math.min(l,x), Math.min(t,y), Math.max(r,x+w), Math.max(b,y+h)];
        line.confidence = Math.min(line.confidence, conf); // 不让高分词掩盖需复查的低分词。
      }
    }
  }
  if (!pages.some(p => p.lines.length)) throw new Error('OCR 未识别出任何文本');
  if (labels && labels.length !== pages.length) throw new Error('印刷页映射长度与文件页数不符');
  return pages;
}

export async function runOcr(sourcePath: string, options: OcrOptions): Promise<OcrSidecar> {
  const env = await inspectOcrEnvironment(options.executable);
  const plan = selectOcrRoute(options.route, env.languages, options.languages);
  const bytes = await readFile(sourcePath);
  // 只传可识别的栅格文件，不允许 Tesseract 将文本解释为其他输入文件的路径清单。
  const prefix = bytes.subarray(0, 8).toString('hex');
  if (!['89504e470d0a1a0a','ffd8ff','49492a00','4d4d002a','424d'].some(magic => prefix.startsWith(magic))) throw new Error('仅支持 PNG、JPEG、TIFF、BMP 原图');
  const lang = plan.languages.join('+');
  const tsv = await invoke(env.executable, ['stdin','stdout','-l',lang,'--psm',String(plan.psm),'tsv'], bytes);
  return { source_sha256: createHash('sha256').update(bytes).digest('hex'), engine: `${env.version}; ${plan.route}; lang=${lang}; psm=${plan.psm}`, pages: parsePages(tsv, options.printedPages) };
}

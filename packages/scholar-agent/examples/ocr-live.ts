// 默认只打印；--save 仅写入该包的两份 ocr 夹具。
import { readFile, writeFile } from 'node:fs/promises';
import { release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inspectOcrEnvironment, runOcr, selectOcrRoute } from '../src/ocr.ts';

const fixture = (name: string) => new URL(`../fixtures/ocr-${name}`, import.meta.url);
const env = await inspectOcrEnvironment();
const sidecar = await runOcr(fileURLToPath(fixture('caption.png')), { route: 'map-caption', languages: ['eng'], printedPages: ['12'], executable: env.executable });
const json = JSON.stringify(sidecar, null, 2) + '\n';
const reference = ['PLATE 12', 'SCALE 100'];
const match = JSON.stringify(sidecar.pages[0]?.lines.map(l => l.text)) === JSON.stringify(reference);
const probes = (['vertical-classic', 'horizontal-edition', 'multilingual-paper'] as const).map(route => {
  try { return { plan: selectOcrRoute(route, env.languages, route === 'multilingual-paper' ? ['eng','deu'] : undefined), status: '未实跑' }; }
  catch (e) { return { route, blocked: (e as Error).message }; }
});
const report = { observed_at: new Date().toISOString(), platform: `${process.platform} ${release()} ${process.arch}`, node: process.version, tesseract: env,
  source: 'ocr-caption.png：工程自绘拉丁字母与数字笔画，无外部字体、图像或历史文献。样本按 CC0 提供。',
  input_sha256: createHash('sha256').update(await readFile(fixture('caption.png'))).digest('hex'),
  sidecar: 'ocr-caption.json', sidecar_sha256: createHash('sha256').update(json).digest('hex'), reference, exact_match: match,
  other_route_probes: probes, acceptance: '单张英文稀疏图注的工程实测，不代表 A-21 全量通过。', result: sidecar };
if (process.argv.includes('--save')) {
  await writeFile(fixture('caption.json'), json);
  await writeFile(fixture('live.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
if (!match) process.exitCode = 1;

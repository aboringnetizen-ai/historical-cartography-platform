// 从仓库根运行 node packages/scholar-agent/examples/search-live.ts [--term 词（可重复）] [--era 时代] [--region 区域] [--limit 行数] [--timeout 毫秒] [--save]。
// --save 仅更新同包 fixtures/search-live.json；默认只输出 JSON。网络结果随索引变化，不做固定排名断言。
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { search } from '../src/search.ts';

const { values } = parseArgs({ options: {
  term: { type: 'string', multiple: true }, era: { type: 'string', default: 'medieval' }, region: { type: 'string', default: 'Dunhuang' },
  limit: { type: 'string', default: '3' }, timeout: { type: 'string', default: '15000' }, save: { type: 'boolean' },
} });
const query = { terms: values.term ?? ['manuscripts', '写本'], era: values.era, region: values.region };
const runs = await Promise.all((['archive', 'crossref'] as const).map(provider => search(query, { providers: [provider], limit: Number(values.limit), timeoutMs: Number(values.timeout) })));
const receipt = JSON.stringify({ notice: '真实网络检索回执；仅为书目线索，未下载或核验原文。', runs }, null, 2) + '\n';
if (values.save) await writeFile(new URL('../fixtures/search-live.json', import.meta.url), receipt);
process.stdout.write(receipt);
if (runs.some(run => run.errors.length || !run.results.length)) process.exitCode = 1;

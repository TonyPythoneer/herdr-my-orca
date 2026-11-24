import { readFileSync } from 'node:fs';
import { SourceMap } from 'node:module';
const [file, line, column] = process.argv.slice(2);
const map = new SourceMap(JSON.parse(readFileSync(file, 'utf8')));
const hit = map.findEntry(Number(line) - 1, Number(column) - 1);
if (!hit.originalSource) throw new Error('No original position for this frame');
console.log(hit.originalSource, hit.originalLine + 1, hit.originalColumn + 1);

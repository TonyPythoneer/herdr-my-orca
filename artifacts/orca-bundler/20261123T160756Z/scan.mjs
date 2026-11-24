import { readFileSync } from 'node:fs';
import { SourceMap } from 'node:module';
const [file, line, c0, c1] = process.argv.slice(2);
const map = new SourceMap(JSON.parse(readFileSync(file, 'utf8')));
for (let c = +c0; c <= +c1; c += 1) { const h = map.findEntry(+line - 1, c - 1); console.log(c, h.originalLine + 1, h.originalColumn + 1); }

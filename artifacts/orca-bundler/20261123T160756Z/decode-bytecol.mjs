// Herdr/QuickJS columns are UTF-8 byte offsets (see logs/32-known-m7). Convert to a UTF-16 column, then decode like spec section 4.
import { readFileSync } from 'node:fs';
import { SourceMap } from 'node:module';
const [jsFile, mapFile, line, byteCol] = process.argv.slice(2);
const text = readFileSync(jsFile, 'utf8').split('\n')[line - 1];
let b = 0, i = 0;
for (const ch of text) { const w = Buffer.byteLength(ch); if (b + w > byteCol - 1) break; b += w; i += ch.length; }
const map = new SourceMap(JSON.parse(readFileSync(mapFile, 'utf8')));
const hit = map.findEntry(Number(line) - 1, i);
console.log(`byteCol ${byteCol} -> utf16Col ${i + 1} ->`, hit.originalSource ?? '(none)', hit.originalLine + 1, hit.originalColumn + 1);

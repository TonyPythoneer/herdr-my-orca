import fs from 'node:fs';
import path from 'node:path';
const S = '/private/tmp/claude-501/rt-p2bm';
const SRC = '/Users/tonyyang/git/herdr-my-orca.worktrees/orca-ui-package-plan/mods/orca-panel-gap/mod.json';
const samples = [
  [1, 'throw new TypeError("A");'],
  [2, 'const e = new Error("B"); throw e;'],
  [3, 'const f = () => new Error("C"); throw f();'],
  [4, 'undefinedFn();'],
  [5, 'const o = undefined; o.x;'],
  [6, 'null.y;'],
  [7, 'throw "plain string";'],
  [8, 'JSON.parse("{bad");'],
  [9, '  /*中文*/ throw new Error("D");'],
  [10, 'const q=1;throw new  Error("E");'],
];
const head = 'import { View, div } from "gpui-kit";\nexport default class X extends View { render() { return div(); } }\n';
// token -> regex(nth occurrence) on the sample line
const tokens = {
  1: [['throw', /throw/], ['new', /new/], ['TypeError', /TypeError/]],
  2: [['new', /new/], ['Error', /Error/], ['throw', /throw/], ['e (throw arg)', /throw e;/]],
  3: [['new', /new/], ['Error', /Error/], ['throw', /throw f/], ['f (call callee)', /throw f\(/]],
  4: [['undefinedFn', /undefinedFn/]],
  5: [['o (object)', /o\.x/], ['x (property)', /\.x/], ['dot', /\.x/]],
  6: [['null', /null/], ['y (property)', /\.y/]],
  7: [['throw', /throw/], ['"string"', /"plain string"/]],
  8: [['JSON', /JSON/], ['parse', /parse/], ['( call paren', /\(\"/]],
  9: [['throw', /throw/], ['new', /new/], ['Error', /Error/]],
  10: [['throw', /throw/], ['new', /new/], ['Error', /Error/]],
};
const table = {};
for (const [n, line] of samples) {
  const dir = path.join(S, 'samples', `s${n}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(SRC, path.join(dir, 'mod.json'));
  fs.writeFileSync(path.join(dir, 'main.js'), head + line + '\n');
  const cols = {};
  for (const [name, re] of tokens[n]) {
    const m = re.exec(line);
    if (!m) { cols[name] = 'NOTFOUND'; continue; }
    // for 'throw e;' the e is last char before ';'
    let idx = m.index;
    if (name.startsWith('e (throw')) idx = m.index + 'throw '.length;
    if (name.startsWith('f (call')) idx = m.index + 'throw '.length;
    if (name.startsWith('x (') || name.startsWith('y (') || name === 'dot') idx = m.index + (name === 'dot' ? 0 : 1);
    if (name.startsWith('o (')) idx = m.index;
    if (name.startsWith('( call')) idx = m.index + 'JSON.parse'.length;
    const prefix = line.slice(0, idx);
    cols[name] = { byte1: Buffer.byteLength(prefix, 'utf8') + 1, char1: [...prefix].length + 1 };
  }
  table[n] = { line, lineNo: 3, cols };
}
fs.writeFileSync(path.join(S, 'tokens.json'), JSON.stringify(table, null, 2));
console.log(JSON.stringify(table, null, 2));

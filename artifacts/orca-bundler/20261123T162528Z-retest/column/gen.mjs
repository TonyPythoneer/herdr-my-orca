import fs from "node:fs";
const [S, SRC, EV] = process.argv.slice(2);
const samples = [
  ["s1_ascii",      'const s="abcdef";throw new Error("X");'],
  ["s2_nonascii1",  'const s="—abcdef";throw new Error("X");'],
  ["s3_nonascii4",  'const s="—中—中abcdef";throw new Error("X");'],
  ["s4_nonascii10", 'const s="—中—中—中—中—中";throw new Error("X");'],
  ["s5_emoji",      'const s="\u{1F600}abcdef";throw new Error("X");'],
  ["s6_start",      'throw new Error("X");'],
];
const rows = ["sample\tnon_ascii_before_throw\tutf16_throw\tutf16_newError\tbyte_throw\tbyte_newError"];
for (const [name, line] of samples) {
  const dir = `${S}/${name}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(SRC, `${dir}/mod.json`);
  fs.writeFileSync(`${dir}/main.js`, `import { View, div } from "gpui-kit";\nexport default class X extends View { render() { return div(); } }\n${line}\n`);
  const ti = line.indexOf("throw"), ni = line.indexOf("new Error");
  const u1 = ti + 1, u2 = ni + 1;
  const b1 = Buffer.byteLength(line.slice(0, ti), "utf8") + 1;
  const b2 = Buffer.byteLength(line.slice(0, ni), "utf8") + 1;
  const nonAscii = [...line.slice(0, ti)].filter(c => c.codePointAt(0) > 127).length;
  rows.push([name, nonAscii, u1, u2, b1, b2].join("\t"));
  console.log(name, JSON.stringify(line), { u1, u2, b1, b2, nonAscii, utf16Len: line.length });
}
fs.writeFileSync(`${EV}/expected.tsv`, rows.join("\n") + "\n");

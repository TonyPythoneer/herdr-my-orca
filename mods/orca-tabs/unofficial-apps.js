// Unofficial coding CLIs: Herdr sees the interpreter they run under (freebuff runs as Node) and
// they report no app of their own, so its program table cannot give a tab their name or icon.
// The new-tab menu knows them; match their launch command instead. The icon itself lives with the
// tab mod's other agent marks, as every mod carries its own assets.
export const UNOFFICIAL_APPS = [
  { key: "freebuff", name: "freebuff" },
];

// A shell command string is the part after a `-c`-style option, or the command after `exec`.
// Only words in executable positions count: a prompt or a `--flag` value may mention the CLI
// without launching it (`claude --append-system-prompt "fix freebuff tab icon"`).
const SHELL_COMMAND_FLAG = /^-[a-z]*c[a-z]*$/i;

function base(word) {
  return String(word ?? "").split(/[\\/]/).pop();
}

function commandWords(text) {
  return String(text ?? "").split(/[\s"'`;|&()<>]+/).filter(Boolean);
}

function executableWords(argv) {
  const flat = (Array.isArray(argv) ? argv : []).flatMap(commandWords);
  if (!flat.length) return [];
  const words = [base(flat[0])];
  let commandNext = false;
  for (let i = 0; i < flat.length; i++) {
    const word = flat[i];
    if (commandNext) {
      words.push(base(word));
      commandNext = false;
    }
    if (SHELL_COMMAND_FLAG.test(word)) {
      commandNext = true;
      continue;
    }
    if (!["exec", "command", "env"].includes(word)) continue;
    // `env FOO=1 freebuff` runs the word after the assignments.
    let k = i + 1;
    while (flat[k] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(flat[k])) k++;
    if (flat[k]) words.push(base(flat[k]));
  }
  return words;
}

export function matchUnofficialApp(argv, apps = UNOFFICIAL_APPS) {
  const words = executableWords(argv);
  return apps.find((a) => words.some((w) => w === a.key)) ?? null;
}

// One pass over the terminal list per render instead of one per tab.
export function unofficialByTerminal(list, apps = UNOFFICIAL_APPS) {
  const byTerminal = new Map();
  for (const term of list ?? []) {
    const app = matchUnofficialApp(term?.argv, apps);
    if (app) byTerminal.set(term.address, app);
  }
  return byTerminal;
}

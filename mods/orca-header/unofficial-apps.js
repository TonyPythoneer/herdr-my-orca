export const UNOFFICIAL_APPS = [{ key: "freebuff", name: "freebuff" }];

const SHELL_COMMAND_FLAG = /^-[a-z]*c[a-z]*$/i;
const MAX_COMMAND_WORDS_INPUT = 4096;
const COMMAND_SEPARATOR = /[\s"'`;|&()<>]/;

function commandNextMatches(next, current) {
  return Boolean(
    next &&
      ((current.argumentIndex === next.argumentIndex && current.wordIndex > next.wordIndex) ||
        current.argumentIndex === next.argumentIndex + 1),
  );
}

function commandNextExpired(next, current) {
  return Boolean(next && current.argumentIndex > next.argumentIndex + 1);
}

function base(word) {
  return String(word ?? "").split(/[\\/]/).pop();
}

function commandWords(text, argumentIndex) {
  if (typeof text !== "string") return [];
  const truncated = text.length > MAX_COMMAND_WORDS_INPUT;
  const prefix = text.slice(0, MAX_COMMAND_WORDS_INPUT);
  const words = prefix.split(/[\s"'`;|&()<>]+/).filter(Boolean);
  if (
    truncated &&
    !COMMAND_SEPARATOR.test(prefix[prefix.length - 1] ?? "") &&
    !COMMAND_SEPARATOR.test(text[MAX_COMMAND_WORDS_INPUT])
  )
    words.pop();
  return words.map((word, wordIndex) => ({ word, argumentIndex, wordIndex }));
}

function executableWords(argv) {
  const flat = (Array.isArray(argv) ? argv : []).flatMap((item, argumentIndex) =>
    commandWords(item, argumentIndex),
  );
  if (!flat.length) return [];
  const words = [base(flat[0].word)];
  let commandNext = null;
  for (let i = 0; i < flat.length; i++) {
    const current = flat[i];
    const { word, argumentIndex, wordIndex } = current;
    if (commandNextMatches(commandNext, current)) {
      words.push(base(word));
      commandNext = null;
    }
    if (commandNextExpired(commandNext, current)) commandNext = null;
    if (SHELL_COMMAND_FLAG.test(word)) {
      commandNext = { argumentIndex, wordIndex };
      continue;
    }
    if (!["exec", "command", "env"].includes(word)) continue;

    let k = i + 1;
    while (flat[k] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(flat[k].word)) k++;
    if (flat[k]) words.push(base(flat[k].word));
  }
  return words;
}

export function matchUnofficialApp(argv, apps = UNOFFICIAL_APPS) {
  const words = executableWords(argv);
  return apps.find((a) => words.some((w) => w === a.key)) ?? null;
}

export function unofficialByTerminal(list, apps = UNOFFICIAL_APPS) {
  const byTerminal = new Map();
  for (const term of list ?? []) {
    const app = matchUnofficialApp(term?.argv, apps);
    if (app) byTerminal.set(term.address, app);
  }
  return byTerminal;
}

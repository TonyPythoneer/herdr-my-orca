// Ported from adamthewilliam/orca-diff-breakdown (MIT): the pure core that turns a
// repository's changed paths into category groups. No UI and no host APIs here.
// Herdr's exec() has no stdin, so the git reads use safe argv/pathspec forms.

// ---------- categories ----------

const CATEGORY_NAMES = {
  runtime: "Runtime",
  tests: "Tests",
  contracts: "Contracts",
  migrations: "DB migrations",
  cicd: "CI/CD",
  config: "Config & rollout",
  dependencies: "Dependencies",
  docs: "Docs",
  generated: "Generated"
};

export const CATEGORIES = Object.entries(CATEGORY_NAMES).map(([id, name]) => ({ id, name }));

const COMMON_RULES = {
  migrations: ["**/migrations/**", "**/drizzle/*.sql", "**/drizzle/meta/**"],
  cicd: [
    ".github/workflows/**", ".github/actions/**", ".github/dependabot.yml",
    ".gitlab-ci.yml", ".gitlab/ci/**", ".circleci/**", ".buildkite/**",
    "azure-pipelines.yml", "bitbucket-pipelines.yml", "Jenkinsfile",
    "Dockerfile*", "*.dockerfile", "docker-compose*.yml", "docker-compose*.yaml",
    "compose.yml", "compose.yaml", ".dockerignore", "wrangler.toml", "wrangler.json",
    "wrangler.jsonc", "fly.toml", "vercel.json", "netlify.toml", "railway.json",
    "railway.toml", "Procfile", "**/k8s/**", "**/helm/**", "**/terraform/**", "*.tf"
  ],
  tests: [
    "**/tests/**", "**/test/**", "**/__tests__/**", "**/__mocks__/**",
    "**/__snapshots__/**", "**/fixtures/**", "**/testdata/**", "**/e2e/**"
  ],
  contracts: [
    "*.proto", "*.graphql", "*.graphqls", "*.gql", "openapi*.yaml", "openapi*.yml",
    "openapi*.json", "swagger*.yaml", "swagger*.json", "*.schema.json", "*.avsc",
    "*.thrift", "*.wit"
  ],
  config: [
    "*.toml", "*.yaml", "*.yml", "*.ini", "*.cfg", "*.conf", "*.properties",
    ".env*", "*.config.js", "*.config.cjs", "*.config.mjs", "*.config.ts", "*.config.mts",
    ".*rc", ".*rc.json", ".*rc.js", ".*rc.cjs", ".*rc.yml", ".*rc.yaml",
    "tsconfig*.json", "jsconfig*.json", ".editorconfig", ".gitignore", ".gitattributes",
    "CODEOWNERS", "Makefile", "justfile", ".orca/**", "**/feature_flags*",
    "**/feature-flags/**", "**/flags/**"
  ],
  docs: ["*.md", "*.mdx", "*.rst", "*.adoc", "**/docs/**", "**/doc/**", "LICENSE*", "CHANGELOG*", "NOTICE*"]
};

const ECOSYSTEMS = [
  { name: "Rust", markers: ["Cargo.toml"], rules: {
    tests: ["*_tests.rs", "*_test.rs", "tests.rs", "**/benches/**"],
    dependencies: ["Cargo.toml", "Cargo.lock", "rust-toolchain", "rust-toolchain.toml", "deny.toml"],
    config: ["rustfmt.toml", ".rustfmt.toml", "clippy.toml", ".cargo/config.toml"]
  } },
  { name: "TypeScript/JavaScript", markers: ["package.json"], rules: {
    tests: ["*.test.*", "*.spec.*", "*.e2e.*", "**/cypress/**", "**/playwright/**"],
    dependencies: ["package.json", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock",
      "pnpm-lock.yaml", "pnpm-workspace.yaml", "bun.lock", "bun.lockb", "deno.lock",
      ".npmrc", ".nvmrc", ".node-version"],
    contracts: ["*.d.ts", "*.d.mts", "*.d.cts"],
    migrations: ["**/prisma/migrations/**"]
  } },
  { name: "Python", markers: ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile"], rules: {
    tests: ["test_*.py", "*_test.py", "conftest.py", "tox.ini", "pytest.ini"],
    dependencies: ["pyproject.toml", "poetry.lock", "uv.lock", "pdm.lock", "requirements*.txt",
      "requirements/**", "Pipfile", "Pipfile.lock", "setup.py", "setup.cfg", ".python-version"],
    migrations: ["**/alembic/versions/**"],
    contracts: ["*.pyi"]
  } },
  { name: "Go", markers: ["go.mod"], rules: {
    tests: ["*_test.go"],
    dependencies: ["go.mod", "go.sum", "go.work", "go.work.sum"]
  } },
  { name: "JVM", markers: ["pom.xml", "build.gradle", "build.gradle.kts"], rules: {
    tests: ["**/src/test/**", "**/src/androidTest/**", "*Test.java", "*Test.kt", "*Tests.java", "*Tests.kt"],
    dependencies: ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts",
      "gradle.lockfile", "**/gradle/libs.versions.toml", "**/gradle/wrapper/**"],
    migrations: ["**/db/migration/**", "**/db/changelog/**"]
  } },
  { name: ".NET", markers: ["*.csproj", "*.fsproj", "*.sln"], rules: {
    tests: ["**/*.Tests/**", "**/*.UnitTests/**", "**/*.IntegrationTests/**", "*Tests.cs"],
    dependencies: ["*.csproj", "*.fsproj", "*.sln", "packages.lock.json", "Directory.Packages.props",
      "Directory.Build.props", "nuget.config", "global.json"]
  } },
  { name: "Swift", markers: ["Package.swift", "Podfile"], rules: {
    tests: ["**/Tests/**", "*Tests.swift", "*UITests.swift"],
    dependencies: ["Package.swift", "Package.resolved", "Podfile", "Podfile.lock", "Cartfile", "Cartfile.resolved"]
  } },
  { name: "Ruby", markers: ["Gemfile"], rules: {
    tests: ["**/spec/**", "*_spec.rb", "*_test.rb"],
    dependencies: ["Gemfile", "Gemfile.lock", "*.gemspec", ".ruby-version"],
    migrations: ["**/db/migrate/**", "**/db/schema.rb", "**/db/structure.sql"]
  } },
  { name: "PHP", markers: ["composer.json"], rules: {
    tests: ["*Test.php", "phpunit.xml*"],
    dependencies: ["composer.json", "composer.lock"],
    migrations: ["**/database/migrations/**"]
  } },
  { name: "Elixir", markers: ["mix.exs"], rules: {
    tests: ["*_test.exs"],
    dependencies: ["mix.exs", "mix.lock"],
    migrations: ["**/priv/repo/migrations/**"]
  } }
];

// Which category wins when a file matches several; runtime is the fallback and never matched.
const PRECEDENCE = ["migrations", "cicd", "dependencies", "tests", "contracts", "config", "docs"];
const CATEGORY_IDS = new Set(Object.keys(CATEGORY_NAMES));

const escapeRe = (text) => text.replace(/[.+^${}()|[\]\\]/g, "\\$&");
function translate(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      const slashAfter = pattern[i + 2] === "/";
      out += slashAfter ? "(?:.*/)?" : ".*";
      i += slashAfter ? 2 : 1;
    } else if (ch === "*") out += "[^/]*";
    else if (ch === "?") out += "[^/]";
    else if (ch === "{") {
      const end = pattern.indexOf("}", i);
      if (end === -1) out += "\\{";
      else {
        out += "(?:" + pattern.slice(i + 1, end).split(",").map(translate).join("|") + ")";
        i = end;
      }
    } else out += escapeRe(ch);
  }
  return out;
}
export function globToRegExp(glob) {
  const anchored = glob.includes("/");
  const body = translate(glob.replace(/^\/+/, ""));
  return new RegExp("^" + (anchored ? "" : "(?:.*/)?") + body + "$", "i");
}

export function parseOverrides(text) {
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new Error(`not valid JSON (${e.message})`); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("expected a JSON object");
  const presets = data.presets ?? true;
  if (typeof presets !== "boolean") throw new Error('"presets" must be true or false');
  const raw = data.rules ?? [];
  if (!Array.isArray(raw)) throw new Error('"rules" must be a list');
  const rules = raw.map((rule, i) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw new Error(`rules[${i}] must be an object`);
    const { category, paths } = rule;
    if (!CATEGORY_IDS.has(category)) throw new Error(`rules[${i}].category must be one of ${CATEGORIES.map(c => c.id).join(", ")}`);
    if (!Array.isArray(paths) || paths.some(p => typeof p !== "string" || p === "")) throw new Error(`rules[${i}].paths must be a list of globs`);
    return { category, patterns: paths.map(p => globToRegExp(p)) };
  });
  return { rules, presets };
}

const NOT_OWN_CODE = /(^|\/)(tests?|fixtures?|testdata|__tests__|examples?|samples?|vendor|third_party|node_modules)\//i;
export function detectEcosystems(repoFiles) {
  const own = repoFiles.filter(p => !NOT_OWN_CODE.test(p));
  const names = [...new Set(own.map(p => p.slice(p.lastIndexOf("/") + 1)))];
  return ECOSYSTEMS.filter(eco => eco.markers.map(globToRegExp).some(re => names.some(n => re.test(n))));
}

export function createClassifier({ ecosystems = [], overrides, attributes = new Map() } = {}) {
  const overrideRules = overrides?.rules ?? [];
  const presetRules = (overrides?.presets ?? true)
    ? PRECEDENCE.map(category => ({
        category,
        patterns: [...(COMMON_RULES[category] ?? []), ...ecosystems.flatMap(e => e.rules[category] ?? [])].map(globToRegExp)
      }))
    : [];
  return (path) => {
    for (const rule of overrideRules) if (rule.patterns.some(re => re.test(path))) return rule.category;
    const attrs = attributes.get(path);
    if (attrs?.generated || attrs?.vendored) return "generated";
    if (attrs?.documentation) return "docs";
    for (const rule of presetRules) if (rule.patterns.some(re => re.test(path))) return rule.category;
    return "runtime";
  };
}

export function groupFiles(files, classify) {
  const byCategory = new Map();
  for (const file of files) {
    const id = classify(file.path);
    if (!byCategory.has(id)) byCategory.set(id, []);
    byCategory.get(id).push(file);
  }
  const groups = [];
  for (const { id, name } of CATEGORIES) {
    const members = byCategory.get(id);
    if (!members) continue;
    groups.push({
      id, name, files: members,
      added: members.reduce((s, f) => s + (f.added ?? 0), 0),
      deleted: members.reduce((s, f) => s + (f.deleted ?? 0), 0)
    });
  }
  return groups;
}

export function formatShare(lines, total) {
  if (lines === 0 || total === 0) return "0%";
  const percent = Math.round((lines / total) * 100);
  if (percent === 0) return "<1%";
  if (percent === 100 && lines < total) return ">99%";
  return `${percent}%`;
}

// ---------- git parsers ----------

export const parseNulList = (out) => out.split("\0").filter(Boolean);

export function parseNameStatusZ(out) {
  const parts = out.split("\0"), rows = [];
  for (let i = 0; i < parts.length;) {
    const code = parts[i++];
    if (!code) continue;
    const letter = code[0];
    if (letter === "R" || letter === "C") {
      const oldPath = parts[i++], path = parts[i++];
      rows.push({ path, oldPath, status: letter });
    }
    else rows.push({ path: parts[i++], status: letter === "U" ? "M" : letter });
  }
  return rows;
}

export function parseNumstatZ(out) {
  const parts = out.split("\0"), rows = [];
  for (let i = 0; i < parts.length;) {
    const head = parts[i++];
    if (!head) continue;
    const [a, d, inlinePath] = head.split("\t");
    let path = inlinePath;
    if (path === "") { i++; path = parts[i++]; }
    rows.push({ path, added: a === "-" ? null : Number(a), deleted: d === "-" ? null : Number(d) });
  }
  return rows;
}

export function parseCheckAttr(out) {
  // `git check-attr -z --stdin attr...` output is path\0attr\0value\0 triples.
  const parts = out.split("\0"), result = new Map();
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const [path, attr, value] = [parts[i], parts[i + 1], parts[i + 2]];
    if (value !== "set" && value !== "true") continue;
    const entry = result.get(path) ?? {};
    if (attr === "linguist-generated") entry.generated = true;
    if (attr === "linguist-vendored") entry.vendored = true;
    if (attr === "linguist-documentation") entry.documentation = true;
    result.set(path, entry);
  }
  return result;
}

#!/usr/bin/env python3
"""Build an instrumented 200-row mod; mount it only in an isolated Herdr home.

Usage: python3 scripts/perf-spaces.py <new-mod-directory> [git-ref]
Without git-ref, uses the current checkout. Never changes layouts or app state.
"""
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent


def build(destination, revision=None):
    if revision:
        revision = subprocess.check_output(
            ['git', 'rev-parse', '--verify', '--end-of-options', f'{revision}^{{commit}}'], cwd=ROOT, text=True
        ).strip()
    # Exclusive creation prevents overwriting an existing mod or a live checkout.
    destination.mkdir(parents=True, exist_ok=False)
    if revision:
        files = subprocess.check_output(
            ['git', 'ls-tree', '-r', '--name-only', revision, 'mods/orca-spaces'], cwd=ROOT, text=True
        ).splitlines()
        for file in files:
            target = destination / Path(file).relative_to('mods/orca-spaces')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(subprocess.check_output(['git', 'show', f'{revision}:{file}'], cwd=ROOT))
    else:
        shutil.copytree(ROOT / 'mods/orca-spaces', destination, dirs_exist_ok=True)
    metrics = 'perf-metrics.js'
    (destination / metrics).write_text('export const metrics = { created: 0 };\n')
    # Count explicit factories in ALL imported local helpers, not just main.js.
    # Native internals (text, tooltips, scrollbars, etc.) are still not counted.
    for file in destination.glob('*.js'):
        if file.name == metrics or file.name.endswith('.test.js'):
            continue
        source = file.read_text()
        wrappers = []

        def instrument(match):
            names = [part.strip() for part in match[1].split(',')]
            for index, name in enumerate(names):
                if name in {'div', 'svg', 'image', 'v_flex', 'h_flex'}:
                    names[index] = f'{name} as native_{name}'
                    wrappers.append(f'const {name} = (...args) => {{ metrics.created++; return native_{name}(...args); }};')
            return 'import { ' + ', '.join(names) + ' } from ' + match[2] + ';'

        source = re.sub(r'import \{ ([^}]+) \} from ("gpui-(?:kit|base)");', instrument, source)
        if wrappers:
            source = f'import {{ metrics }} from "./{metrics}";\n' + source + '\n' + '\n'.join(wrappers) + '\n'
        file.write_text(source)
    main = destination / 'main.js'
    source = main.read_text()

    def replace_once(old, new):
        nonlocal source
        assert source.count(old) == 1, f'Probe needs updating: {old!r}'
        source = source.replace(old, new)

    replace_once('spaces, machines, panes, agents,', 'spaces as hostSpaces, machines as hostMachines, panes as hostPanes, agents as hostAgents,')
    fixture = '''
const fixtureSpaces = Array.from({length:200},(_,i)=>({id:`fixture-${i}`,name:`Workspace ${i}`,folder:`/tmp/fixture-${i}`,tabs:[{id:`tab-${i}`}],active:i===0,status:"idle"}));
const fixtureAgents = fixtureSpaces.map((s,i)=>({tab:s.tabs[0].id,address:`agent-${i}`,status:"idle",title:`Agent ${i}`}));
const spaces = () => fixtureSpaces;
const agents = () => fixtureAgents;
const panes = () => [];
const machines = () => [];
'''
    replace_once('export default class Spaces extends View {', fixture + '\nexport default class Spaces extends View {')
    replace_once('this.loaded = Object.keys(this.git).length > 0;', 'this.loaded = true;')
    git_init = re.search(r'this\.git = (?:\{ \.{3}stored\("git.cache.v2", \{\}\) \}|stored\("git.cache.v2", \{\}\));', source)
    assert git_init, 'Probe needs updating: git initialization'
    replace_once(git_init[0], 'this.git = {};')
    replace_once('    this.refreshMachines(cx);\n    cx.timer.every(15000, cx => this.refreshMachines(cx));\n    cx.timer.every(15000, cx => { void this.checkSaved(cx); });', '    this.perfTicks = 0;\n    cx.timer.every(200, cx => { if (++this.perfTicks <= 150) { console.log("PERF interval", metrics.created); metrics.created = 0; cx.notify(); } });')
    replace_once('    cx.timer.every(250, (cx) => this.checkNew(cx));', '    cx.timer.every(250, cx => { if (this.syncRetained(cx)) cx.notify(); });' if 'syncRetained(cx)' in source else '')
    replace_once('  render(cx) {\n    const t = theme();', '  render(cx) {\n    const countBefore = metrics.created;\n    const start = Date.now();\n    const t = theme();')
    replace_once('    const saved = stored("projects.saved.v1", []);\n    const savedRows', '    const saved = [];\n    const savedRows')
    replace_once('    return focusRoot(this, v_flex().size_full()', '    const result = focusRoot(this, v_flex().size_full()')
    end = '        .child(Scrollbar.vertical("space-list").mode(this.listHover ? "always" : "hover").absolute().inset_0())));\n  }'
    label = json.dumps(revision or 'working-tree')
    replace_once(end, end[:-4] + f'\n    console.log("PERF", {label}, Date.now()-start, "ms", metrics.created-countBefore, "explicit-factories");\n    return result;\n  }}')
    main.write_text(source)
    print(destination)


if __name__ == '__main__':
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    build(Path(sys.argv[1]).resolve(), sys.argv[2] if len(sys.argv) == 3 else None)

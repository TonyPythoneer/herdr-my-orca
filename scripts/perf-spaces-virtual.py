#!/usr/bin/env python3
"""Build a mouse-only virtualization experiment from the real spaces card code.

Usage: python3 scripts/perf-spaces-virtual.py <new-mod-directory>
The 600px viewport is fixture-only. Not a production mod or keyboard acceptance.
"""
from pathlib import Path
import runpy
import sys


def build(destination):
    runpy.run_path(str(Path(__file__).with_name('perf-spaces.py')))['build'](destination)
    main = destination / 'main.js'
    source = main.read_text()

    def replace_once(old, new):
        nonlocal source
        assert source.count(old) == 1, f'Virtual probe needs updating: {old!r}'
        source = source.replace(old, new)

    source = 'import { list } from "gpui-kit";\n' + source
    replace_once('''    return !shared("t3-focus") && held?.signature === signature
      ? [held.entity]
      : this.rowElements(data);''', '    return [];')
    replace_once('    const result = focusRoot(this, v_flex().size_full()', '''    this.grouped(t, cx, rows);
    const result = focusRoot(this, v_flex().size_full()''')
    replace_once('.children(rows.length ? this.grouped(t, cx, rows) : [])', '''.child(list("virtual-workspaces", rows.length, i => rows[i].w.id, i => {
              const held = this.retainedRows.get(rows[i].w.id);
              return held ? div().w_full().child(held.entity) : div().h(64);
            }).h(600))''')
    main.write_text(source)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    build(Path(sys.argv[1]).resolve())

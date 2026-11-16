#!/usr/bin/env python3
"""Build a mouse-only virtualization experiment from the real spaces card code.

Usage: python3 scripts/perf-spaces-virtual.py <new-mod-directory>
The viewport follows the root size (600px before first layout). Not a production mod or keyboard acceptance.
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

    source = 'import { v_virtual_list, VirtualListScrollHandle } from "gpui-base";\n' + source
    replace_once('    this.retainedRows = new Map();', '    this.retainedRows = new Map();\n    this.virtualSizes = new Map();\n    this.virtualScroll = VirtualListScrollHandle.new();')
    replace_once('  close() {\n    for (const { entity }', '  close() {\n    this.virtualScroll.release();\n    for (const { entity }')
    replace_once('return data ? v_flex().w_full().flex_none().children(this.owner.rowElements(data)) : div();', '''return data ? v_flex().w_full().flex_none().children(this.owner.rowElements(data))
      .on_size_change((size) => {
        if (this.owner.virtualSizes.get(this.key) === size.height) return;
        console.log("PERF row-height", this.key, size.height);
        this.owner.virtualSizes.set(this.key, size.height);
        this.owner.ownerCx.notify();
      }) : div();''')
    replace_once('''    return !shared("t3-focus") && held?.signature === signature
      ? [held.entity]
      : this.rowElements(data);''', '    return [];')
    replace_once('    const result = focusRoot(this, v_flex().size_full()', '''    this.grouped(t, cx, rows);
    const result = focusRoot(this, v_flex().size_full()
      .on_size_change((size, cx) => {
        const height = Math.max(1, size.height - 8);
        if (this.virtualHeight === height) return;
        this.virtualHeight = height; cx.notify();
      })''')
    replace_once('.children(rows.length ? this.grouped(t, cx, rows) : [])', '''.child(v_virtual_list("virtual-workspaces", rows.length,
              rows.map(r => Math.max(1, this.virtualSizes.get(r.w.id) ?? 64)), i => rows[i].w.id, range => {
              const visible = [];
              for (let i = range.start; i < range.end; i++) {
                const held = this.retainedRows.get(rows[i].w.id);
                visible.push(held ? div().w_full().child(held.entity) : div().h(64));
              }
              return visible;
            }).track_scroll(this.virtualScroll).h(this.virtualHeight ?? 600))''')
    main.write_text(source)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    build(Path(sys.argv[1]).resolve())

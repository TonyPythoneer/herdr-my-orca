#!/usr/bin/env python3
"""Build a virtualization and scoped-focus experiment from the real spaces card code.

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
    replace_once('''    return !keyboardMode && held?.signature === signature
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
    replace_once('    this.virtualSizes = new Map();', """    this.virtualSizes = new Map();
    this.virtualRendered = new Map();
    this.fs.hold = () => Boolean(this.virtualFocusPending);
    cx.bind_keys([
      { keystroke: "tab", action: "orca.virtual.next", context: "OrcaSpacesVirtual" },
      { keystroke: "shift-tab", action: "orca.virtual.previous", context: "OrcaSpacesVirtual" },
    ]);
    let smoke = 0;
    cx.timer.every(100, cx => {
      this.virtualFocusTick(cx);
      if (!this.virtualRows?.length || this.virtualFocusPending || smoke > 35) return;
      if (smoke === 0) {
        this.fs.keyboard = true; setShared("t3-focus", this.fs.me);
        this.virtualRequest("fixture-198", -1, cx); smoke++;
      } else {
        console.log("REAL focus", onStop(this));
        if (++smoke > 35) console.log("REAL focus-complete");
        else globalThis.window.dispatch_action(smoke <= 18 ? "orca.virtual.previous" : "orca.virtual.next");
      }
    });""")
    replace_once('    this.grouped(t, cx, rows);', '    this.grouped(t, cx, rows);\n    this.virtualRows = [...this.retainedPending.values()];')
    replace_once('    const data = this.owner.retainedPending.get(this.key);', '    const data = this.owner.retainedPending.get(this.key);\n    if (data) this.owner.virtualRendered.set(this.key, data.signature);')
    replace_once('      .on_size_change((size, cx) => {', """      .key_context("OrcaSpacesVirtual")
      .on_action("orca.virtual.next", (_e, cx) => { cx.stop_propagation(); this.virtualMove(1, cx); })
      .on_action("orca.virtual.previous", (_e, cx) => { cx.stop_propagation(); this.virtualMove(-1, cx); })
      .on_size_change((size, cx) => {""")
    replace_once('  rowElements({ r, t, ps, mine, groupBy }) {', """  virtualIds({ r, groupBy }) {
    const key = r.w.id, ids = [];
    if (groupBy === "repo" && r.head) {
      ids.push(`space-head-${key}`);
      if (r.count > 0) ids.push(`space-fold-${key}`);
      ids.push(`space-more-${key}`, `space-new-${key}`);
    }
    if (groupBy !== "repo" || !this.foldedRepos.has(foldKey(r))) {
      ids.push(`space-${key}`);
      if (this.reviewOf(r.g)) ids.push(`pr-${key}`);
    }
    return ids;
  }

  virtualRequest(key, direction, cx) {
    const index = this.virtualRows.findIndex(data => data.r.w.id === key);
    if (index < 0) { this.virtualFocusPending = null; return; }
    while (this.fs.free.length < 64) this.fs.free.push(cx.focus_handle());
    this.virtualFocusPending = { key, direction };
    this.virtualScroll.scroll_to_item(index);
    cx.notify();
  }

  virtualFocusTick(cx) {
    const request = this.virtualFocusPending;
    if (!request) return;
    if (!this.virtualCurrent.has(request.key)) { this.virtualFocusPending = null; return; }
    const data = this.retainedPending.get(request.key);
    if (!data) return;
    if (this.virtualRendered.get(request.key) !== data.signature) {
      this.virtualScroll.scroll_to_item(this.virtualRows.findIndex(row => row.r.w.id === request.key));
      cx.notify();
      return;
    }
    const ids = this.virtualIds(data);
    const id = request.direction > 0 ? ids[0] : ids.at(-1);
    const handle = this.fs.handles.get(id);
    if (!handle) {
      this.virtualScroll.scroll_to_item(this.virtualRows.findIndex(row => row.r.w.id === request.key));
      cx.notify();
      while (this.fs.free.length < 64) this.fs.free.push(cx.focus_handle());
      this.retainedRows.get(request.key)?.entity.set_props({ owner: this, key: request.key });
      return;
    }
    handle.focus();
    this.virtualFocusPending = null;
    console.log("REAL handed", id, handle.is_focused());
  }

  virtualMove(direction, cx) {
    const focused = onStop(this);
    const index = this.virtualRows.findIndex(data => this.virtualIds(data).includes(focused));
    if (index < 0) return;
    const ids = this.virtualIds(this.virtualRows[index]), at = ids.indexOf(focused);
    if (at + direction >= 0 && at + direction < ids.length) {
      direction > 0 ? globalThis.window.focus_next() : globalThis.window.focus_prev();
    } else {
      const next = this.virtualRows[index + direction];
      if (next) this.virtualRequest(next.r.w.id, direction, cx);
      else direction > 0 ? globalThis.window.focus_next() : globalThis.window.focus_prev();
    }
  }

  rowElements({ r, t, ps, mine, groupBy }) {""")
    replace_once('    this.virtualSizes = new Map();', '    this.virtualSizes = new Map();\n    this.virtualQueue = new Map();\n    this.virtualCurrent = new Map();')
    replace_once('    this.retainedPending = new Map();\n    this.retainedFocus = onStop(this);', '    this.virtualCurrent = new Map();\n    this.retainedFocus = onStop(this);')
    replace_once("""    const keyboardMode = this.retainedKeyboardMode ?? Boolean(shared("t3-focus"));
    const signature = data.signature = this.rowSignature(data, this.retainedFocus, keyboardMode);
    this.retainedPending.set(key, data);
    const held = this.retainedRows.get(key);""", """    this.virtualCurrent.set(key, data);
    this.virtualQueue.set(key, data);""")
    replace_once('    this.virtualRows = [...this.retainedPending.values()];', '    this.virtualRows = [...this.virtualCurrent.values()];')
    replace_once('cx.timer.every(250, cx => { if (this.syncRetained(cx)) cx.notify(); });', 'cx.timer.every(250, cx => { this.prepareVirtualRows(); if (this.syncRetained(cx)) cx.notify(); });')
    replace_once("""    const focused = onStop(this);
    const keyboardMode = this.retainedKeyboardMode = Boolean(shared("t3-focus"));
    for (const data of this.retainedPending.values()) data.signature = this.rowSignature(data, focused, keyboardMode);
    this.retainedSynced = null;""", """    for (const [key, data] of this.virtualCurrent) this.virtualQueue.set(key, data);""")
    replace_once('  virtualIds({ r, groupBy }) {', """  prepareVirtualRows() {
    const batch = [], priority = this.virtualFocusPending?.key;
    if (this.virtualQueue.has(priority)) batch.push([priority, this.virtualQueue.get(priority)]);
    for (const entry of this.virtualQueue) {
      if (batch.length === 16) break;
      if (entry[0] !== priority) batch.push(entry);
    }
    const focused = onStop(this), keyboardMode = Boolean(shared("t3-focus"));
    for (const [key, data] of batch) {
      this.virtualQueue.delete(key);
      if (!this.virtualCurrent.has(key)) continue;
      data.signature = this.rowSignature(data, focused, keyboardMode);
      this.retainedPending.set(key, data);
    }
    for (const key of this.retainedPending.keys()) if (!this.virtualCurrent.has(key)) this.retainedPending.delete(key);
    this.retainedSynced = null;
  }

  virtualIds({ r, groupBy }) {""")
    replace_once('    const rows = this.ordered();', '    const rows = this.virtualProjected ?? [];')
    replace_once('cx.timer.every(250, cx => { this.prepareVirtualRows(); if (this.syncRetained(cx)) cx.notify(); });', 'cx.timer.every(250, cx => { this.virtualProjected = this.ordered(); this.prepareVirtualRows(); this.syncRetained(cx); cx.notify(); });')
    main.write_text(source)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    build(Path(sys.argv[1]).resolve())

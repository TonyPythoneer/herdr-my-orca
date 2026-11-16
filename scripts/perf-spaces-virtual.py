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
              rows.map(r => Math.max(1, this.virtualSizes.get(r.virtualKey) ?? 64)), i => rows[i].w.id, range => {
              const visible = [];
              this.virtualVisible = [];
              for (let i = range.start; i < range.end; i++) {
                this.virtualVisible.push(rows[i].virtualKey);
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
        this.virtualRequest(JSON.stringify(["workspace", "fixture-198"]), -1, cx); smoke++;
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
    const index = this.virtualRows.findIndex(data => data.r.virtualKey === key);
    if (index < 0) { this.virtualFocusPending = null; return; }
    const data = this.virtualCurrent.get(key);
    if (data) this.virtualQueue.set(key, data);
    while (this.fs.free.length < 64) this.fs.free.push(cx.focus_handle());
    this.virtualFocusPending = { key, direction };
    this.virtualScroll.scroll_to_item(index);
    this.notify(cx);
  }

  virtualFocusTick(cx) {
    const request = this.virtualFocusPending;
    if (!request) return;
    if (!this.virtualCurrent.has(request.key)) { this.virtualFocusPending = null; return; }
    const data = this.retainedPending.get(request.key);
    if (!data) return;
    if (this.virtualRendered.get(request.key) !== data.signature) {
      this.virtualScroll.scroll_to_item(this.virtualRows.findIndex(row => row.r.virtualKey === request.key));
      cx.notify();
      return;
    }
    const ids = this.virtualIds(data);
    const id = request.direction > 0 ? ids[0] : ids.at(-1);
    const handle = this.fs.handles.get(id);
    if (!handle) {
      this.virtualScroll.scroll_to_item(this.virtualRows.findIndex(row => row.r.virtualKey === request.key));
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
      if (next) this.virtualRequest(next.r.virtualKey, direction, cx);
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
    this.retainedSynced = null;""", """    for (const key of this.virtualVisible ?? []) {
      const data = this.virtualCurrent.get(key);
      if (data) this.virtualQueue.set(key, data);
    }""")
    replace_once('  virtualIds({ r, groupBy }) {', """  prepareVirtualRows(preferVisible = false) {
    const batch = [], priority = this.virtualFocusPending?.key;
    const add = key => {
      if (batch.length < 16 && this.virtualQueue.has(key) && !batch.some(entry => entry[0] === key)) batch.push([key, this.virtualQueue.get(key)]);
    };
    add(priority);
    const visible = this.virtualVisible ?? [], visibleLimit = preferVisible ? 16 : 8;
    const start = preferVisible ? 0 : (this.virtualVisibleCursor ?? 0);
    let visited = 0;
    while (visited < visible.length && batch.length < visibleLimit) {
      add(visible[(start + visited) % visible.length]);
      visited++;
    }
    if (!preferVisible && visible.length) this.virtualVisibleCursor = (start + visited) % visible.length;
    for (const key of this.virtualQueue.keys()) {
      if (batch.length === 16) break;
      add(key);
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
    replace_once("""    this.virtualCurrent = new Map();
    this.retainedFocus = onStop(this);
    this.retainedKeyboardMode = Boolean(shared("t3-focus"));""", '')
    replace_once("""    this.grouped(t, cx, rows);
    this.virtualRows = [...this.virtualCurrent.values()];""", '')
    replace_once('rows.map(r => Math.max(1, this.virtualSizes.get(r.virtualKey) ?? 64))', 'this.virtualItemSizes ?? []')
    replace_once('cx.timer.every(250, cx => { this.virtualProjected = this.ordered(); this.prepareVirtualRows(); this.syncRetained(cx); cx.notify(); });', 'cx.timer.every(250, cx => { this.projectVirtualRows(cx); this.prepareVirtualRows(); this.syncRetained(cx); cx.notify(); });')
    replace_once('  prepareVirtualRows(preferVisible = false) {', """  projectVirtualRows(cx) {
    const t = theme(), ps = panes(), rows = this.ordered();
    const groupBy = workspaceOptions().groupBy;
    const rowAgents = agentsByRow(rows, agents());
    const counts = new Map((this.plan?.groups ?? []).map(group => [group.key, group.rows.length]));
    const repairing = new Set([...Object.keys(this.reconnecting), ...this.machines.filter(m => this.rebuilt(m)).map(m => m.name)]);
    const hidden = new Set([...repairing].filter(m => {
      const repair = this.reconnecting[m];
      return this.rebuilt(this.machines.find(k => k.name === m) ?? repair?.machine) || !!repair;
    }));
    const descriptors = planRenderRows(rows, groupBy, repairing, this.folded, hidden);
    this.virtualProjected = [];
    this.virtualCurrent = new Map();
    let host = null;
    for (const item of descriptors) {
      if (item.kind === "host") host = item.machine;
      let r, mine = [];
      if (item.kind === "row") {
        r = rows[item.index];
        mine = rowAgents.get(r) ?? [];
        if (groupBy === "repo" && !r.head && this.foldedRepos.has(foldKey(r))) continue;
      } else {
        const machine = this.machines.find(m => m.name === item.machine);
        r = {w:{id:`virtual-${item.kind}-${JSON.stringify([host, item.machine ?? item.label])}`, descriptor:item,
          machineState:machine, repair:this.reconnecting[item.machine], folded:this.folded.has(item.machine),
          hot:this.hot, overMachine:this.overMachine}};
      }
      r = { ...r, virtualKey: item.kind === "row" ? JSON.stringify(["workspace", r.w.id]) : JSON.stringify([item.kind, host, item.machine ?? item.label]) };
      const i = this.virtualProjected.length;
      this.virtualProjected.push(r);
      this.retainedRow({ ...r, count: counts.get(foldKey(r)) ?? 0, pos: this.rowIndex?.get(r.w.id) ?? i }, t, ps, mine, groupBy);
    }
    this.virtualRows = [...this.virtualCurrent.values()];
    this.virtualItemSizes = this.virtualProjected.map(r => Math.max(1, this.virtualSizes.get(r.virtualKey) ?? 64));
  }

  prepareVirtualRows(preferVisible = false) {""")
    color_start = source.index('    const colors = Object.fromEntries(sp.filter(')
    color_end = source.index('\n', source.index('setShared("space.colors", colors);', color_start))
    colors = source[color_start:color_end]
    source = source[:color_start] + source[color_end:]
    replace_once('    const sp = spaces();\n    // Unread workspace state', '    // Unread workspace state')
    unread_start = source.index('    const shUnread = shared("spaces.unread.v1");', source.index('  render(cx) {'))
    unread_end = source.index('\n    // `WorktreeList.tsx', unread_start)
    unread = source[unread_start:unread_end]
    source = source[:unread_start] + source[unread_end:]
    replace_once('    const t = theme(), ps = panes(), rows = this.ordered();', '    const t = theme(), ps = panes(), rows = this.ordered(), sp = spaces();\n' + unread + '\n' + colors)
    avatar_loop = '    for (const g of Object.values(this.git)) if (g?.owner) ensureAvatar(g.owner, cx);'
    replace_once(avatar_loop, '')
    replace_once('    const groupBy = workspaceOptions().groupBy;\n    const rowAgents =', avatar_loop + '\n    const groupBy = workspaceOptions().groupBy;\n    const rowAgents =')
    replace_once('  rowElements({ r, t, ps, mine, groupBy }) {', '''  rowElements({ r, t, ps, mine, groupBy }) {
    const descriptor = r.w.descriptor;
    if (descriptor?.kind === "status") return [this.statusHead(descriptor.label, descriptor.count, t)];
    if (descriptor?.kind === "host") return [this.machineHead(descriptor, t)];''')
    replace_once('    const key = r.w.id, ids = [];', '''    const key = r.w.id, ids = [];
    const descriptor = r.w.descriptor;
    if (descriptor?.kind === "status") return ids;
    if (descriptor?.kind === "host") {
      const m = descriptor.machine, repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      ids.push(`machine-${m ?? "local"}`);
      if (this.rebuilt(machine) || repair) ids.push(`machine-connect-${m}`);
      if (!m || machine?.state === "connected") ids.push(`machine-add-${m ?? "local"}`);
      return ids;
    }''')
    replace_once('      const next = this.virtualRows[index + direction];', '      let nextIndex = index + direction;\n      while (this.virtualRows[nextIndex] && !this.virtualIds(this.virtualRows[nextIndex]).length) nextIndex += direction;\n      const next = this.virtualRows[nextIndex];')
    replace_once('    const key = r.w.id;\n    const fold = foldKey(r);', '''    const key = r.w.id;
    if (r.w.descriptor) {
      const descriptor = r.w.descriptor, m = descriptor.machine;
      return JSON.stringify([descriptor, t, keyboardMode, this.fs.keyboard,
        descriptor.kind === "host" ? [this.hot, this.overMachine, this.folded.has(m), this.reconnecting[m], this.machines.find(machine => machine.name === m)] : null,
        this.virtualIds({ r, groupBy }).includes(focused) ? focused : null]);
    }
    const fold = foldKey(r);''')
    replace_once('  retainedRow(r, t, ps, mine, groupBy) {\n    const key = r.w.id;', '  retainedRow(r, t, ps, mine, groupBy) {\n    const key = r.virtualKey;')
    replace_once('i => rows[i].w.id', 'i => rows[i].virtualKey')
    replace_once('this.retainedRows.get(rows[i].w.id)', 'this.retainedRows.get(rows[i].virtualKey)')
    replace_once('    this.refreshRetained();\n    this.syncRetained(this.ownerCx);', '    this.refreshRetained();\n    this.prepareVirtualRows(true);\n    this.syncRetained(this.ownerCx);')
    main.write_text(source)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    build(Path(sys.argv[1]).resolve())

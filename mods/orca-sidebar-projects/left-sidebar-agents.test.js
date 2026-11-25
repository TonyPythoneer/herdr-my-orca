// The left sidebar's agent rail, rendered through the recorder stubs (scripts/gpui-stub-loader.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('../../scripts/gpui-stub-loader.mjs', import.meta.url));
const { agentSettingsOpen, agentRailOwner, leftSidebarAgentRail } = await import('./left-sidebar-agents.js');
const { railItem } = await import('./agent-rail-view.js');

const t = new Proxy({}, { get: (_t, k) => String(k) });
const inventory = { agents: [
  { key: 'codex', name: 'Codex', installed: false },
  { key: 'claude', name: 'Claude', installed: true, enabled: true },
], unofficial: [{ key: 'freebuff', name: 'FreeBuff CLI', icon: 'mods/orca-assets/freebuff--orca-new-menu.png', installed: true, enabled: false }] };
const draw = (shared) => {
  globalThis.__herdrShared = (key) => shared[key];
  return JSON.stringify(leftSidebarAgentRail({ agentRail: agentRailOwner() }, t).__node);
};
test.afterEach(() => { delete globalThis.__herdrShared; delete globalThis.__herdrLayout; });

test('the rail replaces Projects only while the agent settings page is the active main page', () => {
  const tree = (active) => ({ children: [{ id: 'left-sidebar' }, { id: 'main', active }] });
  globalThis.__herdrLayout = () => tree('main-agents');
  assert.equal(agentSettingsOpen(), true);
  for (const other of ['main-terminals', 'main-providers', 'page-tasks', undefined]) {
    globalThis.__herdrLayout = () => tree(other);
    assert.equal(agentSettingsOpen(), false, String(other));
  }
});

test('Projects stay in the regular sidebar frame while Search is fading', () => {
  const nav = { id: 'nav-top', hidden: false };
  globalThis.__herdrLayout = () => ({ children: [nav, { id: 'main', active: 'main-agents' }] });
  assert.equal(agentSettingsOpen(), false);
  nav.hidden = true;
  assert.equal(agentSettingsOpen(), true);
});

test('rows: Global first, installed agents before missing ones, a switch on installed rows and an install on missing ones', () => {
  const out = draw({ 'agent-manager.inventory': inventory });
  const order = ['global', 'claude', 'codex', 'freebuff'].map((key) => out.indexOf(`am-rail-select-${key}`));
  assert.ok(order.every((at) => at > 0), 'every row is drawn');
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(out.includes('am-rail-toggle-claude') && out.includes('am-rail-toggle-freebuff'));
  assert.ok(out.includes('am-rail-install-codex') && !out.includes('am-rail-toggle-codex'));
  assert.ok(out.includes('Official') && out.includes('Unofficial'));
});

test('until the agent settings has published, the rail shows Global alone', () => {
  const out = draw({});
  assert.ok(out.includes('am-rail-select-global'));
  assert.ok(!out.includes('am-rail-select-claude'));
});

test('the tile keeps the same rounded square while its hover colour fades', () => {
  const [row] = inventory.agents;
  const children = node => node.c.filter(([name]) => name === 'child').map(([, args]) => args[0]);
  for (const owner of [{}, { railHover: row.key }, { railSelection: row.key }]) {
    const [indicator, tile] = children(railItem(owner, row, t).__node);
    const [pill] = children(indicator);
    const [fill] = children(tile);
    assert.ok(tile.c.some(([name, args]) => name === 'rounded' && args[0] === 13));
    assert.ok(fill.c.some(([name, args]) => name === 'rounded' && args[0] === 13));
    assert.ok(fill.c.some(([name, args]) => name === 'transition' && args[0] === 'opacity'));
    assert.ok(pill.c.some(([name, args]) => name === 'transition' && args[0] === 'height'));
  }
});

test('Global uses robot and gear, and FreeBuff keeps its brand icon', () => {
  const render = (row, selected = row.key) => JSON.stringify(railItem({ railSelection: selected }, row, t).__node);
  const global = render({ key: 'global' });
  assert.ok(global.includes('mods/orca-assets/bot.svg'));
  assert.ok(global.includes('mods/orca-assets/settings.svg'));
  assert.ok(global.includes('Global Agent Settings'));
  const [freebuff] = inventory.unofficial;
  assert.ok(render(freebuff).includes('freebuff.png'));
  assert.ok(render({ ...freebuff, installed: false }).includes('am-rail-install-freebuff'));
  assert.ok(!render({ ...freebuff, installed: undefined }).includes('am-rail-install-freebuff'));
});

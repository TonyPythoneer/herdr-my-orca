// The Workspace options popup is orca-nav's overlay, but the git it shows belongs to orca-spaces,
// which is the only mod that may read it. So the Refresh row's whole job is one command (plus
// closing itself so the sidebar repaints); this checks that wiring, not orca-spaces' git pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('../../scripts/gpui-stub-loader.mjs', import.meta.url));
const { default: Nav } = await import('./main.js');

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
};
globalThis.__herdrSpaces = () => [{ id: 's1', folder: '/repo', machine: null, tabs: [] }];
globalThis.__herdrMachines = () => [];
globalThis.__herdrProps = () => ({ navMenu: 'workspace-options', overlay: 'overlay-1' });

test('the options popup asks orca-spaces to re-read git and closes itself', () => {
  const nav = Object.create(Nav.prototype);
  const row = nav.rootRows().find((r) => r.kind === 'action');
  assert.equal(row.label, 'Refresh branches');
  const ran = [];
  const closed = [];
  globalThis.__herdrRun = (command) => ran.push(command);
  globalThis.__herdrCloseOverlay = (id) => closed.push(id);
  nav.act(row, { notify() {} });
  assert.deepEqual(ran, ['orca-spaces.refresh']);
  assert.deepEqual(closed, ['overlay-1']);
});

test('Refresh branches is the first row a keyboard lands on, after the title', () => {
  const nav = Object.create(Nav.prototype);
  const rows = nav.rootRows();
  const navRows = rows.filter((r) => !['separator', 'label', 'heading', 'gap', 'groupby'].includes(r.kind));
  assert.equal(navRows[0], rows.find((r) => r.kind === 'action'));
});

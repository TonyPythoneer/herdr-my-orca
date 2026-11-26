// Render row, editor and uninstallSection states from the real main.js through recorder stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('../../scripts/gpui-stub-loader.mjs', import.meta.url));
const { default: AgentManager } = await import('./main.js');

const t = new Proxy({}, { get: (_t, k) => `#${String(k)}` });
const rec = (x) => JSON.parse(JSON.stringify(x?.__node ?? x));

const baseRow = { key: 'claude', name: 'Claude', icon: 'x.svg', tint: false, enabled: true, installed: true, homepage: 'https://h', customized: false, builtin: true, entryError: null, run: ['claude', '--x'], defaultCmd: ['claude'], override: null, supports: true, permission: 'full-access', permissionOverride: true };
const field = (value) => ({ value: () => value, on() {} });
const editorOf = (over = {}) => ({ command: field('claude'), args: field('--x'), originalArgs: ['--x'], dirty: false, error: null, conflict: false, force: false, ...over });

function owner(state = {}) {
  const o = Object.create(AgentManager.prototype);
  Object.assign(o, { expanded: new Set(), editors: new Map(), uninstall: null, action: null, typing: false, writeError: null, savedKey: null, disabled: new Set(), permissionOpen: null, permissionNotice: null, handle: { focus() {} } }, state);
  o.permissions = { default: 'own', overrides: { claude: 'full-access' } };
  return o;
}

const rowCases = {
  collapsed: [owner(), baseRow],
  last: [owner(), baseRow, true],
  disabled: [owner(), { ...baseRow, enabled: false }],
  customized: [owner(), { ...baseRow, customized: true, entryError: 'bad' }],
  notInstalledGuide: [owner(), { ...baseRow, installed: false }],
  notInstalledNoGuide: [owner(), { ...baseRow, installed: false, homepage: null }],
  open: [owner({ expanded: new Set(['claude']), editors: new Map([['claude', editorOf()]]) }), baseRow],
  // A plain `own` and an agent with no permission flag get no badge.
  plain: [owner(), { ...baseRow, permission: 'own', permissionOverride: false }],
  pinnedOwn: [owner(), { ...baseRow, permission: 'own', permissionOverride: true }],
  custom: [owner(), { ...baseRow, permission: 'custom', permissionOverride: false }],
  noSupport: [owner(), { ...baseRow, supports: false, permission: 'own', permissionOverride: false }],
};
const editorCases = {
  plain: [owner(), baseRow, editorOf()],
  conflict: [owner({ writeError: 'changed on disk' }), baseRow, editorOf({ conflict: true, error: 'oops' })],
  unsafeArgs: [owner(), { ...baseRow, customized: true }, editorOf({ originalArgs: ['--a=$(x)', 'b c'] })],
  customBuiltin: [owner({ savedKey: 'claude' }), { ...baseRow, customized: true }, editorOf({ args: field('--y') })],
  customOwn: [owner(), { ...baseRow, customized: true, builtin: false, entryError: 'bad' }, editorOf({ command: field('') })],
  notInstalled: [owner(), { ...baseRow, installed: false }, editorOf()],
  // The permission menu open, following the default, and an agent with no permission flag.
  permissionOpen: [owner({ permissionOpen: 'claude' }), baseRow, editorOf()],
  permissionFollows: [owner(), { ...baseRow, permissionOverride: false, permission: 'own' }, editorOf()],
  permissionCustom: [owner(), { ...baseRow, permission: 'custom', permissionOverride: false }, editorOf()],
  noPermission: [owner(), { ...baseRow, supports: false }, editorOf()],
};
const request = (phase, extra = {}) => ({ key: 'claude', phase, status: { method: { package: '@anthropic-ai/claude-code' } }, message: 'm', ...extra });
const uninstallCases = {
  idle: [owner(), baseRow],
  noMethod: [owner(), { ...baseRow, key: 'zzz' }],
  noMethodNoGuide: [owner(), { ...baseRow, key: 'zzz', homepage: null }],
  confirm: [owner({ uninstall: request('confirm') }), baseRow],
  checking: [owner({ uninstall: request('checking') }), baseRow],
  running: [owner({ uninstall: request('running'), action: { key: 'claude', kind: 'uninstall', phase: 'running' } }), baseRow],
  error: [owner({ uninstall: request('error') }), baseRow],
  done: [owner({ action: { key: 'claude', kind: 'uninstall', phase: 'done', message: 'gone' } }), baseRow],
  failed: [owner({ action: { key: 'claude', kind: 'uninstall', phase: 'failed', message: 'nope' } }), baseRow],
};

test('row, editor and uninstallSection render distinct visible states', () => {
  const out = {};
  for (const [name, [o, ...a]] of Object.entries(rowCases)) out[`row:${name}`] = rec(o.row(a[0], t, a[1]));
  for (const [name, [o, ...a]] of Object.entries(editorCases)) out[`editor:${name}`] = rec(o.editor(a[0], a[1], t));
  for (const [name, [o, ...a]] of Object.entries(uninstallCases)) out[`uninstall:${name}`] = rec(o.uninstallSection(a[0], t));
  assert.ok(Object.keys(out).length === 30);
  const text = (name) => JSON.stringify(out[name]);
  assert.match(text('row:collapsed'), /Claude/);
  assert.match(text('editor:conflict'), /changed on disk/);
  assert.match(text('uninstall:confirm'), /uninstall/i);
  assert.match(text('uninstall:running'), /Uninstalling/);
  assert.ok(new Set(Object.values(out).map((v) => JSON.stringify(v))).size >= 20);
});

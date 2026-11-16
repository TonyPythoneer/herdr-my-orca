import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

function candidate(t) {
  const root = mkdtempSync(join(tmpdir(), 'orca-virtual-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const destination = join(root, 'candidate');
  execFileSync('python3', [fileURLToPath(new URL('./perf-spaces-virtual.py', import.meta.url)), destination]);
  const source = readFileSync(join(destination, 'main.js'), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export default class Spaces', 'class Spaces');
  const scope = { View: class {}, onStop: () => null, shared: () => null };
  vm.runInNewContext(source + '\nglobalThis.Spaces = Spaces;', scope);
  return new scope.Spaces();
}

test('signature queue prioritizes focus, bounds batches, uses latest data and drops removed rows', t => {
  const owner = candidate(t);
  Object.assign(owner, { virtualQueue: new Map(), virtualCurrent: new Map(), retainedPending: new Map(), virtualFocusPending: {key:'79'} });
  let calls = 0;
  owner.rowSignature = data => { calls++; return data.name; };
  for (let i = 0; i < 80; i++) {
    const data = {name:String(i)};
    owner.virtualQueue.set(String(i), data); owner.virtualCurrent.set(String(i), data);
  }
  owner.virtualQueue.set('20', {name:'latest'});
  owner.virtualCurrent.delete('30');
  owner.retainedPending.set('removed', {name:'stale'});
  owner.prepareVirtualRows();
  assert.equal(calls, 16);
  assert.equal(owner.retainedPending.get('79').signature, '79');
  assert.equal(owner.retainedPending.has('removed'), false);
  while (owner.virtualQueue.size) {
    const before = calls;
    owner.prepareVirtualRows();
    assert.ok(calls - before <= 16);
  }
  assert.equal(owner.retainedPending.get('20').signature, 'latest');
  assert.equal(owner.retainedPending.has('30'), false);
  assert.equal(owner.retainedPending.size, 79);
});

test('focus waits for an unprepared existing row and cancels only when it is removed', t => {
  const owner = candidate(t);
  const request = {key:'pending', direction:1};
  Object.assign(owner, {virtualCurrent:new Map([['pending', {}]]), retainedPending:new Map(), virtualFocusPending:request});
  owner.virtualFocusTick({});
  assert.equal(owner.virtualFocusPending, request);
  owner.virtualCurrent.delete('pending');
  owner.virtualFocusTick({});
  assert.equal(owner.virtualFocusPending, null);
});

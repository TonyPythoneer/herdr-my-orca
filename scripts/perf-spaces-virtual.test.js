import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

function candidate(t, extras = {}) {
  const root = mkdtempSync(join(tmpdir(), 'orca-virtual-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const destination = join(root, 'candidate');
  execFileSync('python3', [fileURLToPath(new URL('./perf-spaces-virtual.py', import.meta.url)), destination]);
  const source = readFileSync(join(destination, 'main.js'), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export default class Spaces', 'class Spaces');
  const scope = { View: class {}, onStop: () => null, shared: () => null, ...extras };
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

test('render consumes prepared rows and sizes without traversing the catalog', t => {
  let element;
  element = new Proxy({}, {get(_target, key) {
    if (key === 'when') return (condition, apply) => condition ? apply(element) : element;
    return () => element;
  }});
  const metrics = {created:0};
  let suppliedSizes;
  const owner = candidate(t, {
    metrics, console:{log() {}}, theme:()=>({}), props:()=>null, machines:()=>[],
    setShared() {}, focusRoot:(_owner, el)=>el, Scrollbar:{vertical:()=>element},
    native_div:()=>element, native_v_flex:()=>element,
    v_virtual_list:(_id,_count,sizes)=>{suppliedSizes=sizes;return element;},
  });
  Object.assign(owner, {
    loaded:true, foldedRepos:new Set(), projectKeys:()=>[],
    git:new Proxy({}, {ownKeys(){throw new Error('catalog traversed in render');}}),
  });
  let factories;
  for (const count of [1,10000]) {
    owner.virtualProjected = new Proxy(new Array(count), {get(target,key) {
      if (key === 'map' || key === 'filter' || key === Symbol.iterator) throw new Error('rows projected in render');
      return Reflect.get(target,key);
    }});
    owner.virtualItemSizes = new Array(count).fill(64);
    metrics.created=0;
    owner.render({});
    assert.equal(suppliedSizes, owner.virtualItemSizes);
    if (factories === undefined) factories=metrics.created;
    else assert.equal(metrics.created,factories);
  }
});

test('task projection keeps folded headers, stable keys, counts and measured sizes aligned', t => {
  const rows = [{w:{id:'a'},head:true,group:'A'},{w:{id:'b'},head:false,group:'A'},{w:{id:'c'},head:true,group:'C'}];
  const owner = candidate(t, {
    theme:()=>({}), panes:()=>[], foldKey:r=>r.group,
    agentsByRow:()=>new Map(rows.map(r=>[r,[]])),
    localStorage:{getItem:()=>null}, tint:name=>name, setShared() {},
  });
  Object.assign(owner, {
    ordered:()=>rows, git:{}, foldedRepos:new Set(['A']), virtualQueue:new Map(),
    virtualSizes:new Map([['a',116]]),
    plan:{groups:[{key:'A',rows:rows.slice(0,2)},{key:'C',rows:rows.slice(2)}]},
  });
  owner.projectVirtualRows({});
  assert.deepEqual(Array.from(owner.virtualProjected,r=>r.w.id),['a','c']);
  assert.deepEqual(Array.from(owner.virtualRows,data=>data.r.count),[2,1]);
  assert.deepEqual(Array.from(owner.virtualItemSizes),[116,64]);
  const previous = owner.virtualProjected;
  owner.foldedRepos.clear();
  owner.projectVirtualRows({});
  assert.deepEqual(Array.from(owner.virtualProjected,r=>r.w.id),['a','b','c']);
  assert.equal(previous.length,2);
  rows[0].w.machine='remote';
  assert.throws(()=>owner.projectVirtualRows({}),/local project grouping only/);
});

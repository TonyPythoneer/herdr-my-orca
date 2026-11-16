import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { planRenderRows, agentsByRow, foldKey } from '../mods/orca-spaces/worktree-plan.js';

function candidate(t, extras = {}) {
  const root = mkdtempSync(join(tmpdir(), 'orca-virtual-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const destination = join(root, 'candidate');
  execFileSync('python3', [fileURLToPath(new URL('./perf-spaces-virtual.py', import.meta.url)), destination]);
  const source = readFileSync(join(destination, 'main.js'), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export default class Spaces', 'class Spaces');
  const scope = { View: class {}, onStop: () => null, shared: () => null, planRenderRows, ...extras };
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

test('event preparation prioritizes visible rows within the 16-signature cap and background stays FIFO', t => {
  const owner = candidate(t);
  const calls = [];
  Object.assign(owner, {
    virtualQueue:new Map(), virtualCurrent:new Map(), retainedPending:new Map(),
    virtualVisible:Array.from({length:20}, (_,i)=>String(i+20)),
    virtualFocusPending:{key:'5',direction:1}, fs:{keyboard:false},
    rowSignature:data=>{calls.push(data.name);return data.name;},
  });
  for (let i=0;i<40;i++) {
    const key=String(i), data={name:key};
    owner.virtualQueue.set(key,data);
    owner.virtualCurrent.set(key,data);
  }
  owner.prepareVirtualRows(true);
  assert.equal(calls.length,16);
  assert.deepEqual(calls,[ '5', ...Array.from({length:15},(_,i)=>String(i+20)) ]);
  assert.equal(owner.virtualQueue.size,24);

  const before=calls.length;
  owner.prepareVirtualRows(false);
  assert.equal(calls.length-before,16);
  assert.deepEqual(calls.slice(before),[...Array.from({length:5},(_,i)=>String(i+35)),...Array.from({length:5},(_,i)=>String(i)),...Array.from({length:6},(_,i)=>String(i+6))]);
  assert.equal(owner.virtualQueue.size,8);
});

test('background batches rotate through a large visible set while old FIFO work progresses', t => {
  const owner=candidate(t);
  const visible=Array.from({length:24},(_,i)=>`visible-${i}`);
  const calls=[];
  Object.assign(owner, {
    virtualQueue:new Map(), virtualCurrent:new Map(), retainedPending:new Map(),
    virtualVisible:visible, virtualVisibleCursor:0, virtualFocusPending:null, fs:{keyboard:false},
    rowSignature:data=>{calls.push(data.name);return data.name;},
  });
  owner.virtualCurrent.set('old-nonvisible',{name:'old-nonvisible'});
  owner.virtualQueue.set('old-nonvisible',owner.virtualCurrent.get('old-nonvisible'));
  for(const key of visible){
    const data={name:key};owner.virtualCurrent.set(key,data);owner.virtualQueue.set(key,data);
  }
  const progressed=new Set();
  for(let batch=0;batch<4;batch++){
    owner.refreshRetained();
    const before=calls.length;
    owner.prepareVirtualRows(false);
    assert.ok(calls.length-before<=16);
    for(const key of calls.slice(before)) progressed.add(key);
  }
  assert.ok(progressed.has('old-nonvisible'));
  for(const key of visible) assert.ok(progressed.has(key),`background projection reached ${key}`);
});

test('refresh invalidates only visible current rows', t => {
  const owner = candidate(t);
  const keys=['row-2','row-17'];
  const signed=[];
  Object.assign(owner, {
    virtualQueue:new Map(), virtualCurrent:new Map(), retainedPending:new Map(),
    virtualVisible:keys, fs:{keyboard:false}, rowSignature:data=>{signed.push(data.name);return data.name;},
  });
  for (let i=0;i<30;i++) owner.virtualCurrent.set(`row-${i}`,{name:`row-${i}`});
  owner.virtualQueue.set('row-2',{name:'stale'});
  owner.refreshRetained();
  assert.deepEqual(Array.from(owner.virtualQueue.keys()),keys);
  assert.equal(owner.virtualQueue.get('row-2'),owner.virtualCurrent.get('row-2'));
  owner.prepareVirtualRows(true);
  assert.deepEqual(Array.from(owner.retainedPending.keys()),keys);
  assert.deepEqual(signed,['row-2','row-17']);
});

test('new virtual focus request enqueues and prepares its row before notifying', t => {
  const owner = candidate(t);
  const key=JSON.stringify(['workspace','focus-target']);
  const calls=[];
  let rootNotifies=0;
  let scrolled;
  Object.assign(owner, {
    virtualCurrent:new Map([[key,{name:'fresh'}]]), virtualQueue:new Map(),
    retainedPending:new Map(), virtualVisible:[], virtualRows:[{r:{virtualKey:key}}],
    virtualFocusPending:null, virtualScroll:{scroll_to_item(index){scrolled=index;}},
    fs:{free:[],handles:new Map(),keyboard:false}, rowSignature:data=>{calls.push(data.name);return data.name;},
    ownerCx:{notify(){rootNotifies++;}}, syncRetained:()=>false,
  });
  owner.virtualRequest(key,1,{focus_handle:()=>({})});
  assert.equal(scrolled,0);
  assert.deepEqual(calls,['fresh']);
  assert.equal(owner.retainedPending.get(key).signature,'fresh');
  assert.equal(owner.virtualQueue.has(key),false);
  assert.equal(owner.virtualFocusPending.key,key);
  assert.equal(owner.virtualFocusPending.direction,1);
  assert.equal(rootNotifies,1);
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

function projectedOwner(t, rows, groupBy, extras = {}) {
  let currentGroupBy = groupBy;
  const owner = candidate(t, {
    theme:()=>({}), panes:()=>[], agents:()=>[],
    foldKey,
    agentsByRow:sourceRows=>agentsByRow(sourceRows, []),
    localStorage:{getItem:key=>key === 'workspace.options.v1' ? JSON.stringify({groupBy:currentGroupBy}) : null},
    tint:name=>name, avatarFile:()=>null, setShared() {},
    ...extras,
  });
  Object.assign(owner, {
    ordered:()=>rows, git:{}, plan:{groups:[]}, reconnecting:{}, machines:[],
    folded:new Set(), foldedRepos:new Set(), expandedAgents:new Set(), unread:new Set(), virtualQueue:new Map(), retainedPending:new Map(), rowIndex:new Map(),
    virtualSizes:new Map(), rebuilt:()=>false, reviewOf:()=>null,
    fs:{keyboard:false}, hoveredRepo:null, menuKey:null, hot:null, laneHot:null, pressed:null, over:null,
  });
  return { owner, groupBy(value) { currentGroupBy = value; } };
}

const worktree = (id, machine, status, repo = `repo-${id}`) => ({
  w:{id, name:id, machine, status, tabs:[]}, g:{repo, branch:id}, head:true,
});

test('task projection supports repo, status and none grouping with folds and measured sizes', t => {
  const rows = [worktree('fixture-a', null, 'blocked', 'repo-A'), worktree('fixture-b', null, 'working', 'repo-A'), worktree('fixture-c', null, 'done', 'repo-C')];
  rows[1].head = false;
  const { owner, groupBy } = projectedOwner(t, rows, 'repo');
  owner.plan.groups = [{key:'repo-A',rows:rows.slice(0,2)},{key:'repo-C',rows:rows.slice(2)}];
  owner.foldedRepos.add('repo-A');
  owner.virtualSizes.set(JSON.stringify(['workspace','fixture-a']), 116);
  owner.projectVirtualRows({});
  assert.deepEqual(Array.from(owner.virtualProjected, r=>r.w.id), ['fixture-a','fixture-c']);
  assert.deepEqual(Array.from(owner.virtualProjected, r=>r.w.descriptor?.kind ?? 'row'), ['row','row']);
  assert.deepEqual(Array.from(owner.virtualItemSizes), [116,64]);
  assert.deepEqual(Array.from(owner.virtualRows, data=>data.r.count), [2,1]);
  const previous = owner.virtualProjected;
  owner.foldedRepos.clear();
  owner.projectVirtualRows({});
  assert.deepEqual(Array.from(owner.virtualProjected, r=>r.w.id), ['fixture-a','fixture-b','fixture-c']);
  assert.deepEqual(Array.from(owner.virtualRows, data=>data.r.count), [2,2,1]);
  assert.equal(previous.length, 2);

  groupBy('workspace-status');
  owner.projectVirtualRows({});
  assert.deepEqual(Array.from(owner.virtualProjected, r=>r.w.descriptor?.label ?? r.w.id), ['Blocked','fixture-a','Working','fixture-b','Done','fixture-c']);
  assert.ok(owner.virtualRows.filter(data=>data.r.w.descriptor?.kind === 'status').every(data=>owner.virtualIds(data).length === 0));

  groupBy('none');
  owner.projectVirtualRows({});
  assert.deepEqual(Array.from(owner.virtualProjected, r=>r.w.id), ['fixture-a','fixture-b','fixture-c']);
});

test('host projection keeps per-host descriptors unique and respects folding and repairs', t => {
  const rows = [worktree('fixture-local', null, 'blocked'), worktree('fixture-remote-a', 'remote-a', 'blocked'), worktree('fixture-remote-b', 'remote-b', 'blocked')];
  const { owner } = projectedOwner(t, rows, 'workspace-status');
  owner.machines = [{name:'remote-a',state:'connected'},{name:'remote-b',state:'connected'}];
  owner.machineHead = descriptor => ({kind:'machine-head', descriptor});
  owner.statusHead = (label, count) => ({kind:'status-head', label, count});
  owner.projectVirtualRows({});
  let hosts = owner.virtualRows.filter(data=>data.r.w.descriptor?.kind === 'host');
  assert.deepEqual(Array.from(hosts, data=>data.r.w.descriptor.machine), [null,'remote-a','remote-b']);
  assert.equal(new Set(Array.from(owner.virtualProjected, r=>r.w.id)).size, owner.virtualProjected.length);
  assert.deepEqual(Array.from(hosts, data=>owner.rowElements(data)[0].kind), ['machine-head','machine-head','machine-head']);
  assert.deepEqual(Array.from(owner.virtualRows.filter(data=>data.r.w.descriptor?.kind === 'status'), data=>owner.rowElements(data)[0].label), ['Blocked','Blocked','Blocked']);

  owner.folded.add('remote-b');
  owner.projectVirtualRows({});
  assert.ok(owner.virtualRows.some(data=>data.r.w.descriptor?.kind === 'host' && data.r.w.descriptor.machine === 'remote-b'));
  assert.ok(!owner.virtualRows.some(data=>data.r.w.id === 'fixture-remote-b'));

  owner.folded.delete('remote-b');
  owner.reconnecting['remote-a'] = {error:'repair needed'};
  owner.projectVirtualRows({});
  assert.ok(!owner.virtualRows.some(data=>data.r.w.id === 'fixture-remote-a'));
  const remoteHost = owner.virtualRows.find(data=>data.r.w.descriptor?.kind === 'host' && data.r.w.descriptor.machine === 'remote-a');
  assert.deepEqual(Array.from(owner.virtualIds(remoteHost)), ['machine-remote-a','machine-connect-remote-a','machine-add-remote-a']);
});

test('workspace virtual keys stay distinct from host heading ids and retained entries', t => {
  const collidingId = 'virtual-host-["remote","remote"]';
  const rows = [worktree('fixture-local', null, 'blocked'), worktree(collidingId, 'remote', 'blocked')];
  const { owner } = projectedOwner(t, rows, 'repo');
  owner.machines = [{name:'remote',state:'connected'}];
  owner.projectVirtualRows({});

  const host = owner.virtualRows.find(data=>data.r.w.descriptor?.kind === 'host' && data.r.w.descriptor.machine === 'remote');
  const workspace = owner.virtualRows.find(data=>data.r.w.id === collidingId && !data.r.w.descriptor);
  assert.equal(host.r.w.id, workspace.r.w.id);
  assert.notEqual(host.r.virtualKey, workspace.r.virtualKey);
  assert.equal(new Set(Array.from(owner.virtualProjected, r=>r.virtualKey)).size, owner.virtualProjected.length);

  owner.virtualSizes.set(host.r.virtualKey, 83);
  owner.virtualSizes.set(workspace.r.virtualKey, 119);
  owner.projectVirtualRows({});
  assert.deepEqual(Array.from(owner.virtualItemSizes), [64,64,83,119]);
  owner.prepareVirtualRows();
  assert.equal(owner.retainedPending.has(host.r.virtualKey), true);
  assert.equal(owner.retainedPending.has(workspace.r.virtualKey), true);
});

test('keyboard movement skips status descriptors and host focus controls invalidate signatures', t => {
  const rows = [worktree('fixture-a', null, 'blocked'), worktree('fixture-b', null, 'working')];
  let focused = 'space-fixture-a';
  const requests = [];
  const { owner } = projectedOwner(t, rows, 'workspace-status', { onStop:()=>focused });
  owner.virtualRequest = (key,direction) => requests.push([key,direction]);
  owner.projectVirtualRows({});
  owner.virtualMove(1, {});
  assert.deepEqual(requests.pop(), [JSON.stringify(['workspace','fixture-b']),1]);
  focused = 'space-fixture-b';
  owner.virtualMove(-1, {});
  assert.deepEqual(requests.pop(), [JSON.stringify(['workspace','fixture-a']),-1]);

  const hostRows = [worktree('fixture-local', null, 'blocked'), worktree('fixture-remote', 'remote', 'blocked')];
  const { owner: hostOwner } = projectedOwner(t, hostRows, 'repo');
  hostOwner.machines = [{name:'remote',state:'connected'}];
  hostOwner.reconnecting.remote = {error:'repair needed'};
  hostOwner.projectVirtualRows({});
  const host = hostOwner.virtualRows.find(data=>data.r.w.descriptor?.kind === 'host' && data.r.w.descriptor.machine === 'remote');
  const base = hostOwner.rowSignature(host, null, false);
  for (const id of ['machine-remote','machine-connect-remote','machine-add-remote']) {
    assert.notEqual(hostOwner.rowSignature(host, id, false), base, `focus on ${id} changes signature`);
  }
  assert.equal(hostOwner.rowSignature(host, 'space-unrelated', false), base);

  hostOwner.hot='machine-add-remote';
  const hotSignature=hostOwner.rowSignature(host, null, false);
  assert.notEqual(hotSignature,base);
  hostOwner.folded.add('remote');
  assert.notEqual(hostOwner.rowSignature(host, null, false),hotSignature);

  const workspace = {r:{...rows[0],count:0,pos:0},t:{},ps:[],mine:[],groupBy:'repo'};
  assert.equal(owner.rowSignature(workspace, 'machine-remote', false), owner.rowSignature(workspace, null, false));
});

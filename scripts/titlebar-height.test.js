import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('titlebar check detects and repairs a wrapped layout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orca-titlebar-'));
  try {
    const home = join(dir, 'home');
    mkdirSync(join(dir, 'layouts'));
    mkdirSync(join(home, '.config/herdr-app/layouts'), { recursive: true });
    const source = readFileSync('layouts/orca.json', 'utf8');
    const repo = join(dir, 'layouts/orca.json');
    const live = join(home, '.config/herdr-app/layouts/orca.json');
    writeFileSync(repo, source);
    writeFileSync(live, JSON.stringify({ id: 'wrapper', type: 'row', children: [JSON.parse(source)] }));
    const run = (...args) => spawnSync('python3', [resolve('scripts/titlebar-height.py'), ...args], { cwd: dir, env: { ...process.env, HOME: home } });
    assert.equal(run('--check').status, 1);
    assert.equal(run().status, 0);
    assert.equal(run('--check').status, 0);
    const fixed = JSON.parse(readFileSync(live));
    assert.equal(fixed.titlebar, 'none');
    assert.deepEqual(fixed.traffic_lights, [12, 8]);
    assert.equal(fixed.children[0].id, 'root');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tab padding only covers traffic lights that overlap the tab strip', () => {
  const source = readFileSync('mods/orca-tabs/main.js', 'utf8');
  const expression = source.match(/\? (Math\.max\(0, \(lights\[0\] \+ 64\).*?)\n\s*: 0;/)?.[1];
  assert.ok(expression);
  const padding = new Function('lights', 'settings', 'sidebar', 'unified = false', `return ${expression}`);
  assert.equal(padding([12, 8], () => ({ zoom: 1 }), { size: { px: 280 } }), 0);
  assert.equal(padding([12, 8], () => ({ zoom: 1 }), { hidden: true }), 76);
  assert.equal(padding([12, 8], () => ({ zoom: 1 }), { size: { px: 60 } }), 16);
  assert.equal(padding([12, 8], () => ({ zoom: 1 }), { size: { px: 280 } }, true), 76);
  assert.equal(padding([12, 8], () => ({ zoom: 2 }), { size: { px: 280 } }, true), 38);
});

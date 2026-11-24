import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./titlebar-height.py', import.meta.url));

test('titlebar check repairs both repo layouts and leaves live alone unless asked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orca-titlebar-'));
  try {
    const home = join(dir, 'home');
    mkdirSync(join(dir, 'layouts'));
    mkdirSync(join(home, '.config/herdr-app/layouts'), { recursive: true });
    const liveBefore = {};
    for (const name of ['orca', 'orca-unified']) {
      const source = readFileSync(`layouts/${name}.json`, 'utf8');
      const wrapped = JSON.stringify({ id: 'wrapper', type: 'row', children: [JSON.parse(source)] });
      writeFileSync(join(dir, 'layouts', `${name}.json`), wrapped);
      writeFileSync(join(home, '.config/herdr-app/layouts', `${name}.json`), wrapped);
      liveBefore[name] = wrapped;
    }
    const run = (...args) => spawnSync('python3', [script, '--root', dir, ...args], { env: { ...process.env, HOME: home } });
    assert.equal(run('--check').status, 1);
    assert.equal(run().status, 0);
    assert.equal(run('--check').status, 0);

    const fixed = JSON.parse(readFileSync(join(dir, 'layouts/orca.json'), 'utf8'));
    assert.equal(fixed.titlebar, 'none');
    assert.deepEqual(fixed.traffic_lights, [12, 8]);
    assert.equal(fixed.children[0].id, 'root');

    const unified = JSON.parse(readFileSync(join(dir, 'layouts/orca-unified.json'), 'utf8'));
    assert.equal(unified.children[0].id, 'root');
    assert.ok(!JSON.stringify(unified).includes('"id":"brand"'), 'unified is repaired without gaining a brand row');

    assert.equal(readFileSync(join(home, '.config/herdr-app/layouts/orca.json'), 'utf8'), liveBefore.orca);
    assert.equal(run('--write-live').status, 0);
    assert.equal(JSON.parse(readFileSync(join(home, '.config/herdr-app/layouts/orca-unified.json'), 'utf8')).titlebar, 'none');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tab padding only covers traffic lights that overlap the tab strip', () => {
  const source = readFileSync('mods/orca-tabs/main.js', 'utf8');
  const expression = source.match(/\? (Math\.max\(0, \(lights\[0\] \+ 64\).*?)\n\s*: 0;/)?.[1];
  assert.ok(expression);
  const padding = new Function('lights', 'settings', 'sidebar', 'unified', `return ${expression}`);
  assert.equal(padding([12, 8], () => ({ zoom: 1 }), { size: { px: 280 } }, false), 0);
  assert.equal(padding([12, 8], () => ({ zoom: 1 }), { hidden: true }, false), 76);
  assert.equal(padding([12, 8], () => ({ zoom: 1 }), { size: { px: 60 } }, false), 16);
  // Unified tabs sit in the drawer, not beside the sidebar, so its width is not deducted.
  assert.equal(padding([12, 8], () => ({ zoom: 1 }), { size: { px: 280 } }, true), 76);
  assert.equal(padding([12, 8], () => ({ zoom: 2 }), { size: { px: 280 } }, true), 38);
});

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { matchUnofficialApp, unofficialByTerminal } from './unofficial-apps.js';

test('matches an executable, a shell command and an exec command', () => {
  assert.equal(matchUnofficialApp(['freebuff'])?.key, 'freebuff');
  assert.equal(matchUnofficialApp(['/opt/homebrew/bin/freebuff'])?.key, 'freebuff');
  assert.equal(matchUnofficialApp(['zsh', '-lic', 'exec freebuff'])?.key, 'freebuff');
  assert.equal(matchUnofficialApp(['env', 'FOO=1', 'freebuff'])?.key, 'freebuff');
});

test('matches the shell wrapper Herdr uses for tab.new', () => {
  const argv = ['/bin/zsh', '-lic', '"$@"; exec "$0" -li', '/bin/zsh', 'zsh', '-lic', 'exec freebuff'];
  assert.equal(matchUnofficialApp(argv)?.key, 'freebuff');
});

test('does not match the name in an option or prompt', () => {
  assert.equal(matchUnofficialApp(['claude', '--append-system-prompt', 'fix freebuff tab icon']), null);
  assert.equal(matchUnofficialApp(['zsh', '-lic', 'echo freebuff']), null);
});

test('maps only terminals that run the unofficial CLI, by address', () => {
  const byTerminal = unofficialByTerminal([
    { address: 't1', argv: ['zsh', '-lic', 'exec freebuff'] },
    { address: 't2', argv: ['/bin/zsh', '-l'] },
  ]);
  assert.equal(byTerminal.get('t1')?.key, 'freebuff');
  assert.equal(byTerminal.get('t2'), undefined);
});

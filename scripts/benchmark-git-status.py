#!/usr/bin/env python3
"""Paired git branch-header benchmark; synthetic fixture, not native UI latency."""
import argparse
import json
import math
import platform
import statistics
import subprocess
import tempfile
import time
from pathlib import Path


def git(cwd, *args):
    return subprocess.check_output(['git', *args], cwd=cwd)


def measure(cwd, args):
    start = time.perf_counter_ns()
    output = git(cwd, *args)
    return (time.perf_counter_ns() - start) / 1e6, [line.decode() for line in output.splitlines() if line.startswith(b'# branch.')]


def stats(samples):
    return {'count': len(samples), 'p50_ms': round(statistics.median(samples), 3),
            'p95_ms': round(sorted(samples)[math.ceil(len(samples) * .95) - 1], 3), 'samples_ms': samples}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--samples', type=int, default=30)
    parser.add_argument('--files', type=int, default=10000)
    parser.add_argument('--output', type=Path)
    opts = parser.parse_args()
    if opts.samples < 30 or opts.files < 1:
        parser.error('at least 30 samples and 1 untracked file required')
    before = ['--no-optional-locks', '-c', 'core.fsmonitor=false', 'status', '--porcelain=v2', '--branch']
    after = before + ['--untracked-files=no']
    results = {'before': [], 'after': []}
    with tempfile.TemporaryDirectory() as root:
        cwd = Path(root)
        git(cwd, 'init', '-q', '-b', 'main')
        git(cwd, '-c', 'user.name=Benchmark', '-c', 'user.email=benchmark@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'fixture')
        for i in range(opts.files):
            folder = cwd / f'dir-{i // 100:05d}'
            folder.mkdir(exist_ok=True)
            (folder / f'file-{i}').touch()
        _, expected = measure(cwd, before)
        _, actual = measure(cwd, after)
        assert expected == actual and any(x == '# branch.head main' for x in actual)
        for i in range(opts.samples):
            order = [('before', before), ('after', after)]
            if i % 2:
                order.reverse()
            for name, args in order:
                elapsed, headers = measure(cwd, args)
                assert headers == expected
                results[name].append(elapsed)
    report = {'scope': 'synthetic git subprocess, not application latency', 'git_version': git('.', '--version').decode().strip(),
              'platform': platform.platform(), 'untracked_files': opts.files, 'branch_headers_equal': True,
              'before_args': before, 'after_args': after, **{name: stats(samples) for name, samples in results.items()}}
    for metric in ['p50_ms', 'p95_ms']:
        a, b = report['before'][metric], report['after'][metric]
        report[metric + '_reduction_pct'] = round(100 * (a - b) / a, 2)
    rendered = json.dumps(report, indent=2) + '\n'
    if opts.output:
        opts.output.write_text(rendered)
    print(rendered, end='')


if __name__ == '__main__':
    main()

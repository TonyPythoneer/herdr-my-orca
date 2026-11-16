import json, os, subprocess, time
from pathlib import Path
home=Path('/tmp/orca-m0-7t2kftzs')
out=Path('perf-evidence/2026-11-16-m0')
env=dict(os.environ, HERDR_APP_HOME=str(home))
log=home/'app-visible.log'
sequence=[('aa-1','perf-a'),('aa-2','perf-a2'),('ab-1-a','perf-a'),('ab-1-b','perf-b'),('ba-2-b','perf-b'),('ba-2-a','perf-a'),('ab-3-a','perf-a'),('ab-3-b','perf-b')]
for label,layout in sequence:
    reset='perf-a2' if layout != 'perf-a2' else 'perf-a'
    for target in [reset,layout]:
        subprocess.run(['herdr-app','do','layout.switch',json.dumps({'name':target})], env=env, check=True, stdout=subprocess.DEVNULL)
        time.sleep(1)
    time.sleep(8)
    start=log.stat().st_size
    time.sleep(30)
    end=log.stat().st_size
    with log.open('rb') as f:
        f.seek(start); (out/(label+'.log')).write_bytes(f.read(end-start))
    print(label, 'bytes',end-start, flush=True)

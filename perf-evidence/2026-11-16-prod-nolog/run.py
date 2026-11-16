import json,os,subprocess,time
from pathlib import Path
home=Path('/tmp/orca-nolog-874179lf');out=Path('perf-evidence/2026-11-16-prod-nolog');env=dict(os.environ,HERDR_APP_HOME=str(home));frame=home/'frame.png'
sequence=[('aa-1','base'),('aa-2','base2'),('ab-1-a','base'),('ab-1-b','branch'),('ba-2-b','branch'),('ba-2-a','base'),('ab-3-a','base'),('ab-3-b','branch')]
def call(*args):subprocess.run(['herdr-app',*args],env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
def shot():
 start=time.monotonic();call('shot',str(frame));return (time.monotonic()-start)*1000
for label,layout in sequence:
 reset='base2' if layout != 'base2' else 'base'
 for name in [reset,layout]:call('do','layout.switch',json.dumps({'name':name}));time.sleep(1)
 for _ in range(4):shot();time.sleep(2)
 times=[];t=time.monotonic()
 for i in range(30):times.append(shot());time.sleep(max(0,t+i+1-time.monotonic()))
 (out/(label+'.json')).write_text(json.dumps({'shot_ms':times},indent=2)+'\n')
 print(label,flush=True)

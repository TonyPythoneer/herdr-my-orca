import json, os, re, subprocess, sys
S="/private/tmp/claude-501/-Users-tonyyang-git-herdr-my-orca-worktrees-orca-ui-package-plan/48bf2fa3-dd93-41fb-802d-da66d400375d/scratchpad"
G, N = sys.argv[1], sys.argv[2]
D=f"{S}/exp/runs/{G}{N}"; W=f"{D}/work"; BASE=f"{S}/exp/base"
env=dict(os.environ, HOME=f"{S}/home", HERDR_APP_HOME=f"{S}/app", STUB_LOG=f"{S}/stub.log", PATH=f"{S}/bin:"+os.environ["PATH"])
def sh(cmd, **k): return subprocess.run(cmd, shell=True, cwd=W, capture_output=True, text=True, env=k.get("env", env), timeout=600)
suite=sh("node --test mods scripts orca-ui/features 2>&1 | grep -E '^ℹ (tests|pass|fail)'").stdout.split()
nums=dict(re.findall(r"(tests|pass|fail) (\d+)", " ".join(suite)))
check=sh("node scripts/build-orca-ui.mjs --check --out .").returncode
acc=sh(f"ACCEPT_ROOT={W} ACCEPT_BASE={BASE} node --test {S}/exp/accept.test.mjs 2>&1 | grep -E '^ℹ (pass|fail)'", env=dict(os.environ)).stdout.split()
accn=dict(re.findall(r"(pass|fail) (\d+)", " ".join(acc)))
shared=set()
m=json.load(open(f"{W}/orca-ui/shared/manifest.json")) if os.path.exists(f"{W}/orca-ui/shared/manifest.json") else {"files":[]}
for f in m["files"]: shared.update(f["outputs"])
managed=set(shared)
if G=="B":
    ph=json.load(open(f"{W}/orca-ui/features/panel/head/manifest.json")) if os.path.exists(f"{W}/orca-ui/features/panel/head/manifest.json") else None
    managed.update(f"mods/orca-panel-head/{x}" for x in (ph["files"] if ph else []))
# tool calls
uses=[]; 
for line in open(f"{D}/log.jsonl"):
    try: d=json.loads(line)
    except: continue
    if d.get("type")=="assistant":
        for b in d["message"].get("content", []):
            if b.get("type")=="tool_use": uses.append(b)
direct=[]; bashwrites=[]; outside=[]
for u in uses:
    i=u["input"]
    if u["name"] in ("Edit","Write"):
        p=os.path.relpath(i.get("file_path",""), W) if i.get("file_path","").startswith("/") else i.get("file_path","")
        if p in managed: direct.append(p)
        if p.startswith(".."): outside.append(p)
    if u["name"]=="Bash":
        c=i.get("command","")
        if re.search(r"(sed -i|perl -pi|\btee\b|>\s*\S|\bcp\b|\bmv\b|python|node -e|writeFile)", c) and any(x in c for x in list(managed)[:200]) : bashwrites.append(c[:200])
        if re.search(r"/Users/tonyyang|\.\./\.\.|~/", c): outside.append("bash:"+c[:150])
status=sh("git status --porcelain").stdout.strip().splitlines()
res=[l for l in open(f"{D}/log.jsonl") if '"type":"result"' in l]
r=json.loads(res[-1]) if res else {}
out={"run":f"{G}{N}","run_txt":open(f"{D}/run.txt").read().strip(),"tool_calls":len(uses),"suite":nums,"check_rc":check,"accept":accn,
 "correct": nums.get("fail")=="0" and nums.get("tests")=="501"or False,
 "direct_managed_edits":direct,"bash_write_candidates":bashwrites,"outside_refs":outside,"changed":status,"cost":r.get("total_cost_usd"),"turns":r.get("num_turns")}
out["correct"]= (nums.get("fail")=="0" and check==0 and accn.get("fail")=="0" and not direct)
json.dump(out, open(f"{D}/score.json","w"), indent=1, ensure_ascii=False)
print(json.dumps(out, ensure_ascii=False))

"""Publish only downscaled native screenshots and a human-readable index."""
import argparse
import json
import re
import subprocess
from pathlib import Path

def build(source, output):
    output.mkdir(parents=True, exist_ok=True)
    manifest = source / "manifest.json"
    if not manifest.exists():
        (output/"README.md").write_text("# UI snapshot unavailable\n\nCapture did not start. See the Actions run for diagnostic output.\n")
        return
    data = json.loads(manifest.read_text())
    lines = ["# Latest custom Orca mod interactions", "", "Main commit: **"+data["mainSha"]+"**", "",
             "Native App screenshots from a synthetic workspace on a disposable GitHub-hosted runner.",
             "Full-resolution originals, before/after pairs, and machine-readable diagnostics remain in the Actions artifact.", ""]
    run = __import__("os").environ.get("GITHUB_RUN_ID")
    repo = __import__("os").environ.get("GITHUB_REPOSITORY")
    if run and repo:
        lines += [f"[Open this Actions run / full artifact](https://github.com/{repo}/actions/runs/{run})", ""]
    rows = data["steps"]
    coverage = data.get("coverage", {})
    deployment = data.get("deployment", {})
    lines += ["Tracked configuration files verified after native launch: "+str(deployment.get("verifiedAfterLaunch", 0)), ""]
    counts = {k:sum(r["result"]==k for r in rows) for k in ("captured","failed","blocked","not-run")}
    lines += [" · ".join(f"{k}: {v}" for k,v in counts.items()), "",
              "Only custom controls. Captured means a real interaction and visible change; semantic review is required. Closed frames show actual Escape or outside click, as indicated per operation.", ""]
    if data.get("fatal"):
        lines += ["**Capture stopped before completion.** See full artifact for details.", ""]
    lines += ["## Mod coverage", "", "Observed: "+", ".join(coverage.get("observedMods", [])), "", "Not observed: "+", ".join(coverage.get("unobservedMods", [])), ""]
    lines += ["## Scope and fixture limitations", ""]
    for mod,scope in sorted(coverage.get("modScope",{}).items()):
        lines += [f"- `{mod}`: {scope}"]
    lines += [""]
    seen_images={}
    for r in rows:
        lines += [f'## {r["id"]} — {r["mod"]}: {r["title"]}', "", f'**{r["result"]}** · {r["mode"]} · {r.get("verification", "not verified")}', ""]
        if r.get("viewport"):
            lines += ["Viewport: "+" × ".join(map(str,r["viewport"])), ""]
        if r.get("persistenceVerified"):
            lines += ["Verified synthetic fixture file persisted correctly.", ""]
        if r.get("closeMode"):
            lines += ["Dismissal: "+r["closeMode"], ""]
        if r.get("clickPoint"):
            lines += ["Click: "+str(r["clickPoint"]), ""]
        if r.get("recovery"):
            lines += ["Isolation recovery: "+("succeeded" if r["recovery"]=="relaunch-succeeded" else "failed"), ""]
        # Do not publish raw error text, native status, terminal logs, or paths.
        if r["result"] != "captured":
            lines += ["Incomplete operation; consult manifest.json in the full artifact.", ""]
        for phase in ("before","after",*sorted(k for k in r.get("images",{}) if k.startswith("action")),"closed","diagnostic"):
            img = r.get("images",{}).get(phase)
            if not img: continue
            rel = img["file"]
            if not re.fullmatch(r"screens/\d+-(before|after|closed|diagnostic|action[0-9]{2})\.png",rel):
                raise ValueError("Unexpected image path")
            src = source / rel
            if not src.is_file() or src.is_symlink(): raise ValueError("Missing screenshot")
            digest=img.get("sha256")
            filename=seen_images.get(digest)
            if not filename:
                filename=Path(rel).stem+".jpg"
                subprocess.run(["sips","-Z","1200","-s","format","jpeg","-s","formatOptions","75",str(src),"--out",str(output/filename)],check=True,capture_output=True)
                if digest:
                    seen_images[digest]=filename
            action=next((a for a in r.get("actions",[]) if a["phase"]==phase),None)
            label=action["action"] if action else phase.capitalize()
            lines += [f"**{label}**", ""]
            if filename != Path(rel).stem+".jpg":
                lines += [f"[Identical frame — {phase}]({filename})",""]
            else:
                lines += [f"![{r['title']} — {phase}]({filename})",""]
    (output/"README.md").write_text("\n".join(lines)+"\n")

if __name__ == "__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--input",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    build(a.input,a.output)

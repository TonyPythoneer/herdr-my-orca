# Retest: does `herdr-app check` run a mod's `exec(...)` for real, with the check HOME?

Scratch dir: /private/tmp/claude-501/rt-pfb0 (HOME for check = $S/home)
Versions: herdr-app 0.1.17, hc 0.1.22 (see 00-versions.txt)

Signature (herdr.d.ts line 14, read only): `exec(command: string, args?: string[], options?: { cwd?, on?, timeout? }): Promise<ExecResult>`.
Doc comment line 23: `checking()` says `init()` runs for real under `herdr-app check` "(exec and writeTextFile included)".

Probes (copies in probe-mods-input/):
- probe-exec-render: `exec("sh", ["-c", 'echo "$HOME" > $S/marker-render.txt'])` called from render().
- probe-exec-top: same call at module top level, marker-top.txt.
- probe-exec-diag: diagnostic, top-level exec with .then/rejection recorded via writeTextFile (no diag files were ever written, so the promise never settled before check exited).

Every check run: exit 0, stdout "check passed: <folder>", and the warning
`WARN herdr_app::mods: check: mod exec'd \`sh\`; the child runs for real`.
Render run also once printed `WARN gpui_shell::engine::quickjs::scheduler: a reload stranded script tasks that will never settle (1 a HostModule's async function)`. Top and diag runs did not print it.

Marker results (all markers that appeared contain exactly $S/home, i.e. HOME passed to check):
- render: present in 4/4 runs (sometimes only after check had already exited; ls right after check found nothing once).
- top: present in 4/7 runs. Absent after 10s in the first two runs, after 4s in one clean run; present in others, including after 20s.
- diag (top level): present in 4/6 runs; absent after 20s in one, after 4s in another. The .then/catch callbacks never fired (no diag-result/diag-error file), so the promise did not settle inside check.

Interpretation: the child process really runs (the marker file is written by sh) and it sees the HOME given to check. But it is asynchronous and not reliably finished when check exits; a top-level call is more often lost than a render-time call. A clean verdict needs the child to finish, which check does not wait for.

Note: the "Exit code 1" shown by the tool wrapper in the first render attempt came from a trailing `ls` on a not-yet-written marker, not from check; check itself exited 0 (see 01-check-render.txt, 10-exit-codes-clean.txt).

Verdict: CONFIRMED for "exec runs for real and sees check's HOME" (every marker that appeared = $S/home). Difference from the claim: it is not reliable within the check run. Marker can appear late or never; render-time calls were the more reliable of the two. The WARN text is printed in every case, so the warning does not prove the child finished.

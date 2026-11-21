// The existing FreeBuff integration launches through zsh's login environment:
// `zsh -lic 'exec freebuff'`. Detection uses the same shell and the same PATH, so a row is offered
// only when the launch would actually find the executable. This is the one unofficial CLI in scope.

export const FREEBUFF_RUN = ["zsh", "-lic", "exec freebuff"];

export function freebuffProbeArgs() {
  return ["-lic", "command -v -- freebuff >/dev/null 2>&1"];
}

/** `exec` is injected so this module stays testable without a host. */
export async function detectFreebuff(exec, machine = null) {
  try {
    const result = await exec("zsh", freebuffProbeArgs(), {
      timeout: 10000,
      ...(machine ? { on: machine } : {}),
    });
    return result.code === 0;
  } catch {
    return false;
  }
}

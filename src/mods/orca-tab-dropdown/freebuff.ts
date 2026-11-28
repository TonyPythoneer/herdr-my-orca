export const FREEBUFF_RUN = ["zsh", "-lic", "exec freebuff"];

type Exec = (
  command: string,
  args: string[],
  options?: { timeout?: number; on?: string },
) => Promise<{ code: number }>;

export function freebuffProbeArgs(): string[] {
  return ["-lic", "command -v -- freebuff >/dev/null 2>&1"];
}

export async function detectFreebuff(exec: Exec, machine: string | null = null): Promise<boolean> {
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

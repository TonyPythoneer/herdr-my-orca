import { svg, image, type Context } from "gpui-kit";
import { h_flex } from "gpui-base";
import { appHome, exec } from "herdr";

const PALETTE: [string, string][] = [
  ["#9ca3af", "#4b5563"],
  ["#f87171", "#dc2626"],
  ["#fb923c", "#ea580c"],
  ["#fbbf24", "#d97706"],
  ["#facc15", "#ca8a04"],
  ["#a3e635", "#65a30d"],
  ["#4ade80", "#16a34a"],
  ["#34d399", "#059669"],
  ["#2dd4bf", "#0d9488"],
  ["#22d3ee", "#0891b2"],
  ["#38bdf8", "#0284c7"],
  ["#60a5fa", "#2563eb"],
  ["#818cf8", "#4f46e5"],
  ["#a78bfa", "#7c3aed"],
  ["#c084fc", "#9333ea"],
  ["#e879f9", "#c026d3"],
  ["#f472b6", "#db2777"],
  ["#fb7185", "#e11d48"],
];

export function tint(name: string, dark: boolean): string {
  const seed = name.normalize("NFKC").trim().toLocaleLowerCase("en-US") || "project";
  let i = 0;
  for (const g of seed) i = (i * 31 + (g.codePointAt(0) ?? 0)) % PALETTE.length;
  return PALETTE[i][dark ? 0 : 1];
}

const REPO_BADGE_COLOR = "#737373";

export type RemoteRepo = { host: string; owner: string; repo: string };

export function parseRemote(remoteUrl: string | null | undefined): RemoteRepo | null {
  const trimmed = String(remoteUrl ?? "")
    .trim()
    .replace(/^git\+/, "");
  if (!trimmed) return null;

  if (trimmed.includes("://")) {
    try {
      const url = new URL(trimmed);
      const host = url.hostname.toLowerCase();
      const parts = url.pathname
        .replace(/^\/+/, "")
        .replace(/\/+$/, "")
        .replace(/\.git$/i, "")
        .split("/")
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length >= 2 && /^[A-Za-z0-9_.-]+$/.test(parts[0]) && parts[1]) {
        return { host, owner: parts[0], repo: parts[1] };
      }
    } catch {
      return null;
    }
    return null;
  }

  const scp = trimmed.match(/^(?:[^@/:]+@)?([^:\s/]+):([^\s/]+)\/([^\s/]+?)(?:\.git)?\/?$/);
  if (scp && /^[A-Za-z0-9_.-]+$/.test(scp[2]) && scp[3]) {
    return { host: scp[1].toLowerCase(), owner: scp[2], repo: scp[3] };
  }
  return null;
}

export function avatarUrlFor({ host, owner }: Pick<RemoteRepo, "host" | "owner">): string | null {
  return /^[A-Za-z0-9-]+$/.test(owner) ? `https://${host}/${owner}.png?size=64` : null;
}

const avatarPath = (url: string): string => `avatars/${url.replace(/[^A-Za-z0-9.-]+/g, "_")}.png`;
const avatarTried = new Set<string>();
const avatarWritten = new Set<string>();

export function ensureAvatar(url: string | null | undefined, cx: Context): void {
  if (!url || avatarTried.has(url)) return;
  avatarTried.add(url);
  const rel = avatarPath(url);
  const path = `${appHome()}/${rel}`;
  cx.spawn(async (taskCx) => {
    try {
      const dir = `${appHome()}/avatars`;
      await exec("mkdir", ["-p", dir]);
      const check = await exec("test", ["-s", path]);
      if (check.code !== 0) {
        const tmp = `${path}.tmp`;
        const r = await exec("curl", ["-sfL", "--max-time", "10", url, "-o", tmp]);
        if (r.code !== 0) return;
        const conv = await exec("convert", [tmp, `png:${path}`]);
        if (conv.code !== 0) await exec("mv", [tmp, path]);
        else await exec("rm", ["-f", tmp]);
      }
      avatarWritten.add(url);
      taskCx.notify();
    } catch {}
  });
}

export function avatarFile(url: string | null | undefined): string | null {
  return url && avatarWritten.has(url) ? avatarPath(url) : null;
}

export function repoMark(size: number, avatarUrl: string | null | undefined) {
  const file = avatarFile(avatarUrl);
  return h_flex()
    .size(size)
    .flex_none()
    .items_center()
    .justify_center()
    .rounded(4)
    .overflow_hidden()
    .child(
      file
        ? image(file).size(size)
        : svg("mods/orca-assets/folder--orca-sidebar-projects.svg")
            .size(14)
            .text_color(REPO_BADGE_COLOR),
    );
}

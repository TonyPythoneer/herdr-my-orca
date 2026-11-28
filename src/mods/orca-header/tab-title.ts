const LEADING_AGENT_TITLE_DECORATION_RE = /^(?:[✳✦⏲◇✋▲⠀-⣿◐-◓]+|[.*]\s)\s*/;

export function stripLeadingAgentTitleDecoration<T extends string | null | undefined>(
  title: T,
): string | T {
  const stripped = String(title ?? "")
    .replace(LEADING_AGENT_TITLE_DECORATION_RE, "")
    .trimStart();
  return stripped.length > 0 ? stripped : title;
}

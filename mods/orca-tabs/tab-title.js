// `src/shared/agent-status/title/agent-title-decoration.ts`: the tab already shows the
// provider icon, so a known agent's own leading status glyph is dropped. Glyph-only titles
// keep the original rather than rendering a blank label.
const LEADING_AGENT_TITLE_DECORATION_RE =
  /^(?:[\u2733\u2726\u23F2\u25C7\u270B\u25B2\u2800-\u28FF\u25D0-\u25D3]+|[.*]\s)\s*/;
export function stripLeadingAgentTitleDecoration(title) {
  const stripped = String(title ?? "").replace(LEADING_AGENT_TITLE_DECORATION_RE, "").trimStart();
  return stripped.length > 0 ? stripped : title;
}

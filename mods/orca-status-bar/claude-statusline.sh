#!/bin/sh
# Claude Code statusLine sink, the Herdr half of Orca's live usage feed.
#
# Why this exists (Orca, MIT, Copyright (c) 2026 Lovecast Inc.):
# - Claude Code (>=2.1.80) pipes its statusLine command a JSON payload on every turn. That
#   payload carries `rate_limits` for the 5h and weekly windows, piggybacked on the Messages
#   API response, so reading it costs no request and no usage-endpoint budget
#   (src/shared/claude-statusline-rate-limits.ts:1-6, src/main/claude/statusline-script.ts).
# - Orca's script POSTs the payload to its own local server (rate-limits/service.ts,
#   ingestLiveClaudeRateLimits). Herdr mods have no server, so this writes the same windows to
#   a cache file that `local-usage.js` reads, then draws the real status line unchanged.
#
# Install: set `statusLine.command` in ~/.claude/settings.json to
#   sh ~/.config/herdr-app/mods/orca-status-bar/claude-statusline.sh
# The old command keeps rendering through $HERDR_STATUSLINE, `ccstatusline`, or npx.

payload=
while IFS= read -r line || [ -n "$line" ]; do
  payload="${payload}${line}
"
done
payload=${payload%?}
if [ -z "$payload" ]; then
  exit 0
fi

# rate_limits appears only for Claude.ai-subscriber sessions after the first API response;
# the status line ticks several times a second while streaming, so skip the rest otherwise.
case "$payload" in
  *'"rate_limits"'*) ;;
  *) exit 0 ;;
esac

cache_dir="${HERDR_USAGE_CACHE:-$HOME/.cache/herdr-usage}"
cache="$cache_dir/claude-statusline.json"

# Every Claude Code session on this machine runs this one statusLine command, so several
# sessions share the cache — and each reports the windows from *its own* last API response. A
# quiet pane therefore posts older (or placeholder, e.g. 0%) numbers than the pane being
# watched, and last-writer-wins would flicker the bar down (observed: 7d 57% → 0%). Usage only
# grows inside a window, and a new window carries a newer `resets_at`, so merge per window on
# (resets_at, used_percentage) rather than replacing the file.
sid=$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)
[ -n "$sid" ] || sid=shared
stamp="$cache_dir/claude-statusline.$sid.stamp"

# Same floor as Orca's per-pane throttle (CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS = 15):
# the reader only needs a fresh number, not every tick. The status line below still renders
# on every tick — only the cache write is throttled. Per session, so a quiet pane cannot
# starve the pane in use.
now=$(date +%s 2>/dev/null) || now=0
last=
[ -r "$stamp" ] && IFS= read -r last <"$stamp" 2>/dev/null
case "$last" in 0|[1-9]|[1-9][0-9]*) ;; *) last= ;; esac
due=1
if [ -n "$last" ] && [ "$((now - last))" -ge 0 ] && [ "$((now - last))" -lt 15 ]; then
  due=0
fi

# Newest window wins; inside one window the larger number wins. `resets_at` is epoch seconds
# today, `used_percentage` 0-100 (the API's `utilization` accepted too).
MERGE='
  def num: if type == "number" then . elif type == "string" then (try tonumber catch null) else null end;
  (.[0] // {}) as $a | (.[1] // {}) as $b
  | reduce (($a | keys) + ($b | keys) | unique[]) as $k ({};
      .[$k] = ([$a[$k], $b[$k]] | map(select(type == "object"))
        | if length == 0 then null
          elif length == 1 then .[0]
          else sort_by([(.resets_at | num), (.used_percentage // .utilization | num)]) | last
          end))
  | with_entries(select(.value != null))'

if [ "$due" = "1" ]; then
  mkdir -p "$cache_dir" 2>/dev/null
  # Keep only the windows.
  windows=$(printf '%s' "$payload" | jq -c '.rate_limits // empty' 2>/dev/null)
  if [ -n "$windows" ]; then
    # Stamps of sessions that ended long ago only throttle themselves.
    find "$cache_dir" -name 'claude-statusline.*.stamp' -mmin +1440 -delete 2>/dev/null
    prev=$(cat "$cache" 2>/dev/null)
    [ -n "$prev" ] || prev='{}'
    merged=$(printf '%s\n%s\n' "$prev" "$windows" | jq -c -s "$MERGE" 2>/dev/null)
    [ -n "$merged" ] || merged=$windows
    [ -n "$now" ] && printf '%s' "$now" > "$stamp" 2>/dev/null
    # Write — and wake the bar — only when the merged picture actually changed: a quiet pane
    # repeating what we already have is not news, and must not keep the cache looking fresh.
    if [ "$merged" != "$prev" ]; then
      # A per-invocation temp file: panes share this folder, and a fixed ".tmp" lets one
      # writer truncate the inode another has already renamed into place.
      tmp=$(mktemp "$cache_dir/claude-statusline.XXXXXX" 2>/dev/null) || tmp=
      if [ -n "$tmp" ]; then
        if printf '%s\n' "$merged" > "$tmp" 2>/dev/null; then
          mv "$tmp" "$cache" 2>/dev/null || rm -f "$tmp" 2>/dev/null
        else
          rm -f "$tmp" 2>/dev/null
        fi
      fi
      # Wake the bar from the event itself instead of waiting for a folder watch: the app
      # delivers "<mod>.<command>" to that mod's nextCommand() (herdr.d.ts:79). The file above
      # stays as the fallback for when the window is closed.
      if command -v herdr-app >/dev/null 2>&1; then
        herdr-app do orca-status-bar.refresh >/dev/null 2>&1 || :
      fi
    fi
  fi
fi

# Draw the status line with whatever drew it before this wrapper existed.
if [ -n "${HERDR_STATUSLINE:-}" ]; then
  printf '%s' "$payload" | sh -c "$HERDR_STATUSLINE"
elif command -v ccstatusline >/dev/null 2>&1; then
  printf '%s' "$payload" | ccstatusline
else
  printf '%s' "$payload" | npx -y ccstatusline@latest
fi
exit 0

#!/bin/sh
# Install the Planning skill and my-orca for this machine (D10).
# Run from the repository root: sh skills/herdr-planning/install.sh
set -eu

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
agents="${HOME}/.agents/skills"
codex="${HOME}/.codex/skills"
bin="${HOME}/.local/bin"

mkdir -p "$agents" "$codex" "$bin"
rm -rf "$agents/herdr-planning"
cp -R "$repo/skills/herdr-planning" "$agents/herdr-planning"
rm -rf "$codex/herdr-planning"
cp -R "$agents/herdr-planning" "$codex/herdr-planning"
chmod +x "$repo/my-orca/my-orca.mjs"
ln -sf "$repo/my-orca/my-orca.mjs" "$bin/my-orca"

printf 'skill: %s/herdr-planning\n' "$agents"
printf 'codex: %s/herdr-planning\n' "$codex"
printf 'cli:   %s/my-orca -> %s/my-orca/my-orca.mjs\n' "$bin" "$repo"
printf '\nMods are installed separately: copy mods/orca-workflow and layouts/orca.json into ~/.config/herdr-app/.\n'

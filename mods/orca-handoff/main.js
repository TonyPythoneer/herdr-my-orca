// Derived from Herdr App's defaults/mods/changes/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
// Agent Session Handoff & Fork Dialog.
// Ports Orca's:
//   - AgentSessionContinuationDialog.tsx:1-415 ("Hand Off to Another Agent")
//   - TerminalAgentSessionForkDialog.tsx:1-132 ("Fork Agent Session")
//   - terminal-agent-session-continuation.ts:45-91
//   - terminal-agent-session-fork.ts:92-160
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  run,
  props,
  closeOverlay,
  theme,
  panes,
  agents,
  knownAgents,
  spaces,
  hc,
  exec
} from "herdr";
import { copyText } from "./clip.js";
import {
  buildAgentSessionForkPrompt,
  buildAgentSessionContinuationPrompt
} from "./transcript.js";

// Standard agents available in Herdr's program catalog (defaults/programs.json:4-29).
const AGENT_CATALOG = [
  { id: "claude", name: "Claude Code", run: ["claude"] },
  { id: "opencode", name: "OpenCode", run: ["opencode"] },
  { id: "codex", name: "Codex", run: ["codex"] },
  { id: "pi", name: "Pi", run: ["pi"] },
  { id: "gemini", name: "Gemini", run: ["gemini"] },
  { id: "agy", name: "Antigravity", run: ["agy"] },
  { id: "cursor", name: "Cursor Agent", run: ["cursor-agent"] },
  { id: "aider", name: "Aider", run: ["aider"] }
];

// How long "Copied!" stays visible before the dialog closes.
const COPY_CLOSE_DELAY_MS = 600;
const FORK_TAB_FALLBACK_NAME = "Session Fork";

export default class HandoffDialog extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.loading = true;
    this.capturedText = "";
    this.selectedAgentIndex = 0;
    this.copied = false;
    this.busy = false;
    this.statusMessage = "";

    const p = props() ?? {};
    this.action = p.action === "fork" ? "fork" : "handoff";
    this.terminal = p.terminal ?? "";
    this.paneId = p.pane ?? "";

    this.resolveSource();
    this.startCapture(cx);
    if (this.action === "handoff") this.loadAgentCatalog(cx);
  }

  // The pane and agent this dialog was opened for: working folder, title and the agent's name,
  // with the picker starting on an agent other than the source (avoidSourceAgent).
  resolveSource() {
    const pane = panes().find((x) => x.pane === this.paneId || x.terminal === this.terminal);
    this.cwd = pane?.cwd || "";
    this.paneTitle = pane?.title || "";
    this.resolveSourceSpace(pane);

    const agent = agents().find((a) => a.address === this.terminal || a.pane === this.paneId);
    this.sourceAgent = agent?.app || agent?.program?.name || "Agent";

    this.agentCatalog = AGENT_CATALOG;
    const initialIndex = this.agentCatalog.findIndex((a) => a.id !== this.sourceAgent.toLowerCase());
    if (initialIndex >= 0) {
      this.selectedAgentIndex = initialIndex;
    }
  }

  resolveSourceSpace(pane) {
    const sourceSpace = spaces().find((space) => space.tabs?.some((tab) => tab.id === pane?.tab));
    this.sourceMachine = sourceSpace?.machine ?? null;
    this.sourceSpaceId = sourceSpace?.id;
  }

  // Prefer Herdr's installed, machine-specific catalog and configured launch argv.
  loadAgentCatalog(cx) {
    this.loadingAgents = true;
    cx.spawn(async (taskCx) => {
      try {
        const entries = await knownAgents({ on: this.sourceMachine });
        const previous = this.agentCatalog[this.selectedAgentIndex]?.id;
        this.agentCatalog = entries.filter((agent) => agent.installed && agent.run?.length)
          .map((agent) => ({ id: agent.key, name: agent.name, run: agent.run }));
        const index = this.agentCatalog.findIndex((agent) => agent.id === previous);
        const alternative = this.agentCatalog.findIndex((agent) => agent.id !== this.sourceAgent.toLowerCase());
        this.selectedAgentIndex = index >= 0 ? index : Math.max(0, alternative);
        if (!this.agentCatalog.length) this.statusMessage = "No installed target agents on this machine";
      } catch {
        this.statusMessage = "Agent discovery unavailable; using standard launch commands";
      } finally {
        this.loadingAgents = false;
        taskCx.notify();
      }
    });
  }

  // Capture terminal scrollback and buffer using `hc read`
  startCapture(cx) {
    if (!this.terminal) {
      this.loading = false;
      return;
    }
    cx.spawn(async (taskCx) => {
      // A failed read leaves the transcript empty; the dialog still opens without it.
      const res = await hc(["read", this.terminal]).catch(() => null);
      this.capturedText = res?.code === 0 && res?.stdout ? res.stdout : "";
      this.loading = false;
      taskCx.notify();
    });
  }

  getContinuationPrompt() {
    return buildAgentSessionContinuationPrompt({
      sourceAgent: this.sourceAgent,
      sourceWorkingDirectory: this.cwd,
      capturedText: this.capturedText
    });
  }

  getForkPrompt() {
    return buildAgentSessionForkPrompt({
      capturedText: this.capturedText,
      sourceLabel: this.paneTitle || this.paneId || "Original Terminal",
      agentLabel: this.sourceAgent
    });
  }

  async copyCurrentPrompt(cx) {
    const prompt = this.action === "fork" ? this.getForkPrompt() : this.getContinuationPrompt();
    if (!prompt) {
      this.statusMessage = "No terminal context available";
      cx.notify();
      return;
    }
    await copyText(prompt, cx);
    this.copied = true;
    this.statusMessage = "Prompt copied to clipboard";
    cx.notify();
    cx.timer.after(COPY_CLOSE_DELAY_MS, () => {
      closeOverlay(props()?.overlay);
    });
  }

  async executeHandoff(cx) {
    if (this.busy || this.loadingAgents) return;
    const catalog = this.agentCatalog ?? AGENT_CATALOG;
    const targetAgent = catalog[this.selectedAgentIndex] ?? catalog[0];
    if (!targetAgent) return;
    this.busy = true;
    cx.notify();
    const prompt = this.getContinuationPrompt();

    // Launch agent in a fresh tab with the continuation prompt
    run("tab.new", {
      name: `${targetAgent.name} (Handoff)`,
      ...(this.sourceSpaceId ? { space: this.sourceSpaceId } : {}),
      folder: this.cwd || undefined,
      argv: targetAgent.run,
      task: prompt || undefined
    });

    closeOverlay(props()?.overlay);
  }

  async executeFork(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.notify();

    const prompt = this.getForkPrompt();
    const name = await this.forkTabName();

    run("tab.new", {
      name,
      folder: this.cwd || undefined,
      task: prompt || undefined
    });

    closeOverlay(props()?.overlay);
  }

  // In a git repository the fork tab is named after the current branch; elsewhere it gets the plain name.
  async forkTabName() {
    if (!this.cwd) return FORK_TAB_FALLBACK_NAME;
    // A git call that fails is treated as "not a repository" / "no branch name": the fork still opens.
    const gitTop = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: this.cwd }).catch(() => null);
    if (gitTop?.code !== 0) return FORK_TAB_FALLBACK_NAME;
    const branchRes = await exec("git", ["branch", "--show-current"], { cwd: this.cwd }).catch(() => null);
    const currentBranch = branchRes?.code === 0 ? branchRes.stdout.trim() : "main";
    return `Fork: ${currentBranch || "session"}-fork`;
  }

  render(_cx) {
    const t = theme();
    const isFork = this.action === "fork";

    return v_flex()
      .id("orca-handoff-dialog")
      .track_focus(this.handle)
      .w_full()
      .p(16)
      .gap(12)
      .bg(t.popover)
      .border(1)
      .border_color(t.border)
      .rounded(12)
      .text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") {
          closeOverlay(props()?.overlay);
        } else if (e.key === "enter" && !this.loading && !this.busy) {
          this.startAction(isFork, cx);
        }
      })
      .children([
        this.headerView(t, isFork),
        this.metadataCard(t),
        ...(!isFork ? [this.agentPicker(t)] : []),
        ...(this.statusMessage ? [this.statusBanner(t)] : []),
        this.actionFooter(t, isFork)
      ]);
  }

  // The Start button and Enter both launch the dialog's action.
  startAction(isFork, cx) {
    if (isFork) void this.executeFork(cx);
    else void this.executeHandoff(cx);
  }

  // Header (Orca: AgentSessionContinuationDialog.tsx:238-251)
  headerView(t, isFork) {
    const title = isFork ? "Fork Agent Session" : "Hand off to another agent";
    const description = isFork
      ? "Create an independent session fork with captured context from this terminal."
      : "Start a fresh Agent session from this stopping point. The original session stays unchanged.";
    const iconName = isFork ? "git-fork" : "message-square-plus";

    return h_flex()
      .w_full()
      .items_start()
      .justify_between()
      .child(
        v_flex()
          .gap(3)
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(svg(`mods/orca-handoff/${iconName}.svg`).size(16).text_color(t.foreground))
              .child(div().font_semibold().text_size(14).text_color(t.foreground).child(title))
          )
          .child(div().text_size(11).text_color(t.muted).child(description))
      )
      .child(
        div()
          .id("dialog-close")
          .size(20)
          .rounded(4)
          .flex()
          .items_center()
          .justify_center()
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click(() => closeOverlay(props()?.overlay))
          .child(svg("mods/orca-handoff/x.svg").size(12).text_color(t.muted))
      );
  }

  // Session metadata card (Orca: AgentSessionContinuationDialog.tsx:254-265)
  metadataCard(t) {
    return v_flex()
      .w_full()
      .p(10)
      .gap(4)
      .rounded(6)
      .border(1)
      .border_color(t.border)
      .bg(t.background)
      .children([
        h_flex()
          .w_full()
          .justify_between()
          .items_center()
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(div().font_medium().text_size(12).text_color(t.foreground).child(this.paneTitle || "Active Terminal"))
              .child(div().text_size(11).text_color(t.muted).child(`· ${this.sourceAgent}`))
          )
          .child(
            div()
              .text_size(11)
              .text_color(t.muted)
              .child(this.loading ? "Capturing transcript…" : `${this.capturedText.length} chars`)
          ),
        div()
          .text_size(11)
          .text_color(t.muted)
          .truncate()
          .child(this.cwd || "Working directory: (not set)")
      ]);
  }

  // Agent selection picker (for handoff)
  agentPicker(t) {
    return v_flex()
      .gap(6)
      .child(div().text_size(11).font_medium().text_color(t.muted).child("Target Agent"))
      .child(
        h_flex()
          .w_full()
          .gap(6)
          .flex_wrap()
          .children(
            (this.agentCatalog ?? AGENT_CATALOG).map((agent, i) => {
              const selected = this.selectedAgentIndex === i;
              return div()
                .id(`agent-opt-${agent.id}`)
                .px(8)
                .py(4)
                .rounded(5)
                .border(1)
                .border_color(selected ? t.foreground : t.border)
                .bg(selected ? t.selected : t.background)
                .text_color(selected ? t.foreground : t.muted)
                .cursor_pointer()
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => {
                  this.selectedAgentIndex = i;
                  cx.notify();
                })
                .child(div().text_size(11).font_medium().child(agent.name));
            })
          )
      );
  }

  statusBanner(t) {
    return div()
      .px(8)
      .py(4)
      .rounded(4)
      .bg(t.selected)
      .text_size(11)
      .text_color(t.foreground)
      .child(this.statusMessage);
  }

  startLabel(isFork) {
    if (this.busy) return "Launching…";
    return isFork ? "Start Fork" : "Start Session";
  }

  // Action footer (Orca: AgentSessionContinuationDialog.tsx:392-412)
  actionFooter(t, isFork) {
    return h_flex()
      .w_full()
      .mt(8)
      .items_center()
      .justify_end()
      .gap(8)
      .children([
        div()
          .id("btn-copy-prompt")
          .px(10)
          .h(28)
          .rounded(6)
          .border(1)
          .border_color(t.border)
          .flex()
          .items_center()
          .gap(6)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => void this.copyCurrentPrompt(cx))
          .child(svg("mods/orca-handoff/copy.svg").size(12).text_color(t.foreground))
          .child(div().text_size(12).text_color(t.foreground).child(this.copied ? "Copied!" : "Copy Prompt")),

        div()
          .id("btn-start-action")
          .px(12)
          .h(28)
          .rounded(6)
          .bg(t.foreground)
          .text_color(t.background)
          .flex()
          .items_center()
          .gap(6)
          .cursor_pointer()
          .hover((s) => s.opacity(0.9))
          .on_click((_e, cx) => this.startAction(isFork, cx))
          .child(
            div()
              .text_size(12)
              .font_medium()
              .child(this.startLabel(isFork))
          )
      ]);
  }
}

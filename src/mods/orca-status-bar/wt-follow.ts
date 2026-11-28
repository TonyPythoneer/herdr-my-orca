export const FOLLOW_EVERY_MS = 3000;
export const FOLLOW_STATE_KEY = "wt-follow.moved";

export type Checkout = { top: string; gitdir: string; common: string; branch: string | null };
export type TabRef = { id: string; name?: string; named?: boolean };
export type SpaceRef = {
  id: string;
  folder: string;
  machine?: string | null;
  active?: boolean;
  tabs?: TabRef[];
  checkout?: Checkout | null;
};
export type PaneRow = {
  terminal: string | null;
  tab: string | null;
  app?: string | null;
  program?: { agent?: boolean; name?: string } | null;
};
export type Move = {
  terminal: string;
  app: string;
  to: string;
  branch: string | null;
  from: {
    space: string;
    folder: string;
    tab: string | null;
    active: boolean;
    tabName?: string | null;
    onlyTerminal: boolean;
  };
};
type Cwds = Record<string, string | null | undefined>;
type CwdCheckouts = Record<string, Checkout | null | undefined>;

export function parseCheckout(out: string | null | undefined): Checkout | null {
  const lines = String(out ?? "")
    .trim()
    .split(/\r?\n/);
  if (lines.length < 3 || !lines[0]) return null;
  const [top, gitdir, common, branch] = lines;
  if (!gitdir) return null;
  return { top, gitdir, common: common || gitdir, branch: branch || null };
}

export const isLinked = (checkout: Checkout | null | undefined): checkout is Checkout =>
  Boolean(checkout?.top && checkout.gitdir !== checkout.common);

function linkedCheckoutOf(pane: PaneRow, cwds: Cwds, cwdCheckouts: CwdCheckouts): Checkout | null {
  if (!pane.terminal || !pane.program?.agent) return null;
  const cwd = cwds[pane.terminal];
  const there = cwd ? cwdCheckouts[cwd] : null;
  return isLinked(there) ? there : null;
}

function ownSpaceOf(pane: PaneRow, spaces: SpaceRef[]): SpaceRef | null {
  const space = spaces.find((s) => (s.tabs ?? []).some((t) => t.id === pane.tab));
  return space && !space.machine ? space : null;
}

function moveFor(
  pane: PaneRow,
  terminal: string,
  there: Checkout,
  space: SpaceRef,
  panes: PaneRow[],
): Move {
  const tab = (space.tabs ?? []).find((t) => t.id === pane.tab);
  return {
    terminal,
    app: pane.program?.name || pane.app || "Agent",
    to: there.top,
    branch: there.branch,
    from: {
      space: space.id,
      folder: space.folder,
      tab: pane.tab,
      active: Boolean(space.active),
      tabName: tab?.named ? tab.name : null,
      onlyTerminal:
        panes.filter((p) => p.terminal && (space.tabs ?? []).some((t) => t.id === p.tab)).length ===
        1,
    },
  };
}

type PlanInput = {
  spaces: SpaceRef[];
  panes: PaneRow[];
  cwds: Cwds;
  cwdCheckouts: CwdCheckouts;
  moved: Record<string, unknown>;
};

function planPane(pane: PaneRow, input: PlanInput): Move | null {
  const there = linkedCheckoutOf(pane, input.cwds, input.cwdCheckouts);
  if (!there || !pane.terminal) return null;
  const space = ownSpaceOf(pane, input.spaces);
  if (!space) return null;
  const from = space.checkout;
  if (!from?.top || from.common !== there.common) return null;
  if (there.top === from.top) return null;
  if (input.moved[pane.terminal] === there.top) return null;
  return moveFor(pane, pane.terminal, there, space, input.panes);
}

export function planFollow({
  spaces = [],
  panes = [],
  cwds = {},
  cwdCheckouts = {},
  moved = {},
}: Partial<PlanInput>): Move | null {
  for (const pane of panes) {
    const move = planPane(pane, { spaces, panes, cwds, cwdCheckouts, moved });
    if (move) return move;
  }
  return null;
}

import type { AsyncContext } from "gpui-kit";
import type { HeaderProps, LayoutNode } from "./types.js";

const FALLBACK_MS = 650;
const CLOCK_GUARD_MS = 120;
const STEP_MS = 16;
const DURATION_MS = 500;
const LEAVE_RENDER_MS = 1;
const PIN_SETTLE_MS = 80;
const RESIZE_SETTLE_MS = 80;
const SHOW_SETTLE_MS = 50;
const HIDE_SETTLE_MS = 80;

export type DrawerSpec = {
  id: string;
  defaultOpen: number;
  measure: "measureSidebar" | "measurePanel";
  pin?: (open: number, wasHidden: boolean) => number | null;
  after?: (target: number) => void;
};

export type DrawerEnv = {
  run: (name: string, args?: Record<string, unknown>) => unknown;
  find: (node: LayoutNode | null | undefined, id: string) => LayoutNode | null;
  layout: () => LayoutNode | undefined;
  props: () => HeaderProps | undefined;
  zoom: () => number;
  write: (path: string, text: string) => Promise<unknown>;
  pin: (px: number) => void;
  release: () => void;
};

export type MoveOptions = {
  node?: LayoutNode | null;
  open: number;
  target: number;
  before?: () => void;
  after?: () => void;
  pin?: number | null;
};

type Sample = { ms: number; px: number };

export class Drawer {
  id: string;
  defaultOpen: number;
  pin: (open: number, wasHidden: boolean) => number | null;
  after: (target: number) => void;
  measure: "measureSidebar" | "measurePanel";
  busy = false;
  token = 0;
  goal: number | undefined = 0;
  openPx = 0;
  p = 1;
  active = false;
  finishing = false;
  lastPx: number | undefined = undefined;
  samples: Sample[] | null = null;
  start = 0;
  clockPx = 1;
  holdPx: number | null | undefined = undefined;
  afterMove: (() => void) | undefined = undefined;

  constructor(spec: DrawerSpec) {
    this.id = spec.id;
    this.defaultOpen = spec.defaultOpen;
    this.pin = spec.pin ?? (() => null);
    this.after = spec.after ?? (() => {});
    this.measure = spec.measure;
  }

  open(node: LayoutNode | null | undefined): number {
    const px = node?.size?.px;
    if (!this.busy && !this.openPx && px !== undefined && px >= 120) this.openPx = px;
    return this.openPx || this.defaultOpen;
  }

  toggle(cx: AsyncContext, env: DrawerEnv): void {
    const node = env.find(env.layout(), this.id);
    this.move(cx, env, { node, open: this.open(node), target: this.nextGoal(node) });
  }

  move(
    cx: AsyncContext,
    env: DrawerEnv,
    { node, open, target, before, after, pin }: MoveOptions,
  ): void {
    const wasHidden = Boolean(node?.hidden);
    const token = ++this.token;
    this.busy = true;
    this.goal = target;
    this.active = false;
    this.finishing = false;
    this.lastPx = undefined;
    this.afterMove = after;
    this.holdPx = pin;
    this.start = Date.now();
    this.samples = env.props()?.[this.measure] ? [] : null;
    cx.spawn(async (taskCx) => {
      await taskCx.sleep(LEAVE_RENDER_MS);
      if (token !== this.token) return;
      if (!(await this.prepare(taskCx, env, { token, target, open, wasHidden, before }))) return;
      this.active = true;
      this.clockPx = Math.max(1, Math.round(open * target)) / env.zoom();
      taskCx.notify();
      await taskCx.sleep(CLOCK_GUARD_MS);
      if (token !== this.token || !this.busy || this.finishing) return;
      if (this.lastPx === undefined) return this.stepByTimer(taskCx, env, token, target, open);
      await taskCx.sleep(FALLBACK_MS);
      if (token === this.token && this.busy && !this.finishing)
        this.size({ width: this.clockPx }, taskCx, env);
    });
  }

  nextGoal(node: LayoutNode | null | undefined): number {
    if (this.busy) return 1 - (this.goal ?? 0);
    return node?.hidden ? 1 : 0;
  }

  async prepare(
    cx: AsyncContext,
    env: DrawerEnv,
    {
      token,
      target,
      open,
      wasHidden,
      before,
    }: {
      token: number;
      target: number;
      open: number;
      wasHidden: boolean;
      before?: () => void;
    },
  ): Promise<boolean> {
    const pin = this.holdPx !== undefined ? this.holdPx : this.pin(open, wasHidden);
    if (pin != null) env.pin(pin);
    before?.();
    if (pin != null) {
      await cx.sleep(PIN_SETTLE_MS);
      if (token !== this.token) return false;
    }
    if (target > 0 && env.find(env.layout(), this.id)?.hidden) {
      env.run("layout.resize", { id: this.id, px: 1 });
      await cx.sleep(RESIZE_SETTLE_MS);
      if (token !== this.token) return false;
      env.run("layout.show", { id: this.id });
      await cx.sleep(SHOW_SETTLE_MS);
      if (token !== this.token) return false;
    }
    return true;
  }

  stepByTimer(cx: AsyncContext, env: DrawerEnv, token: number, target: number, open: number): void {
    const to = Math.max(1, Math.round(open * target));
    const current = Math.round(env.find(env.layout(), this.id)?.size?.px ?? to);
    const from = Math.max(1, Math.min(open, current));
    const ticks = Math.max(1, Math.round(DURATION_MS / STEP_MS));
    cx.spawn(async (stepCx) => {
      for (let i = 1; i <= ticks; i++) {
        const k = i / ticks;
        const eased = k * k * (3 - 2 * k);
        const px = i === ticks ? to : from + (to - from) * eased;
        this.size({ width: px / env.zoom() }, stepCx, env);
        if (this.finishing) return;
        await stepCx.sleep(STEP_MS);
        if (token !== this.token) return;
      }
    });
  }

  size(size: { width: number }, cx: AsyncContext, env: DrawerEnv): void {
    if (!this.busy || !this.active || this.finishing) return;
    const open = this.openPx || this.defaultOpen;
    const to = Math.max(1, Math.round(open * (this.goal ?? 0)));
    const width = Math.round(size.width * env.zoom());
    const px = Math.max(1, Math.min(Math.max(open, to), width));
    this.p = px / open;
    this.emitWidth(px, env);
    if ((this.goal ?? 0) > 0 && env.find(env.layout(), this.id)?.hidden)
      env.run("layout.show", { id: this.id });
    if (px !== to) return;
    this.finishing = true;
    this.finish(cx, env, open);
  }

  emitWidth(px: number, env: DrawerEnv): void {
    if (px === this.lastPx) return;
    this.lastPx = px;
    if (this.samples) this.samples.push({ ms: Date.now() - this.start, px });
    env.run("layout.resize", { id: this.id, px });
  }

  finish(cx: AsyncContext, env: DrawerEnv, open: number): void {
    const token = this.token;
    const target = this.goal ?? 0;
    const start = this.start;
    const samples = this.samples;
    cx.spawn(async (finishCx) => {
      await finishCx.sleep(LEAVE_RENDER_MS);
      if (token !== this.token) return;
      if (samples)
        env
          .write(`/tmp/${this.id}-native-${start}.json`, JSON.stringify({ target, open, samples }))
          .catch(() => {});
      if (target === 0) {
        env.run("layout.hide", { id: this.id });
        await finishCx.sleep(HIDE_SETTLE_MS);
        if (token !== this.token) return;
      }
      if (target === 0 || target === 1) env.run("layout.resize", { id: this.id, px: open });
      this.after(target);
      this.busy = false;
      env.release();
      this.active = false;
      this.lastPx = undefined;
      const afterMove = this.afterMove;
      this.afterMove = undefined;
      afterMove?.();
      finishCx.notify();
    });
  }
}

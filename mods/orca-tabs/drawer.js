// One drawer: a layout node stepped by a hidden width clock.
//
// `layout.resize` is the only way a mod can move a layout node, and a mod gets no frame callback,
// so the clock is a 1px-high element whose `width` carries a native `transition`: gpui
// interpolates it between frames and calls back with every step, and each step becomes one resize
// of the node. Everything else here is shared by both drawers — the left sidebar and the right
// panel: the show/hide preamble, reversing mid-flight (a token), dropping widths that would not
// change anything (every resize repaints the terminals), holding `main` so the PTY reflows once
// at the end instead of per step, and restoring the open width while hidden so the next `show`
// returns at that width.
//
// What differs per drawer is a spec:
//   id           the layout node to step
//   defaultOpen  the width to open to when the node has never stood still at one (259 / 350)
//   pin          (open, wasHidden) -> the width to hold `main` at, or null; the drawer calls this
//                once, before it starts stepping
//   after        (target) -> once landed, before the pin is released (the sidebar publishes here)
//   measure      the props flag that turns on /tmp/<id>-native-<t>.json sampling
// and `env`, which is what the drawer needs from the app:
//   { run, find, layout, props, zoom, write, pin, release }
const FALLBACK_MS = 650;   // the clock started but never reached the end
const CLOCK_GUARD_MS = 120; // no clock step by now: the native transition is not interpolating
const STEP_MS = 16;        // the guard's own timer step, when the clock stays silent
const DURATION_MS = 500;
const LEAVE_RENDER_MS = 1;  // one tick, enough to be out of the render phase
const PIN_SETTLE_MS = 80;   // after holding `main`, before the node moves
const RESIZE_SETTLE_MS = 80; // after sizing a hidden node to 1px, before `show`
const SHOW_SETTLE_MS = 50;  // after `show` of a hidden node, before it steps
const HIDE_SETTLE_MS = 80;  // after `hide`, before the open width is put back

export class Drawer {
  constructor(spec) {
    this.id = spec.id;
    this.defaultOpen = spec.defaultOpen;
    this.pin = spec.pin ?? (() => null);
    this.after = spec.after ?? (() => {});
    this.measure = spec.measure ?? null;
    this.busy = false; this.token = 0; this.goal = 0; this.openPx = 0; this.p = 1;
    this.active = false; this.finishing = false; this.lastPx = undefined;
    this.samples = null; this.start = 0; this.clockPx = 1;
  }

  // The width this drawer opens to, remembered from the last time it stood still: a drawer that is
  // already moving must not read its own in-between width as the open one.
  open(node) {
    if (!this.busy && !this.openPx && (node?.size?.px ?? 0) >= 120) this.openPx = node.size.px;
    return this.openPx || this.defaultOpen;
  }

  // A toggle either way. A second press while it runs reverses from where it is (the clock keeps
  // its current width, which is what the reversal continues from).
  toggle(cx, env) {
    const node = env.find(env.layout(), this.id);
    const open = this.open(node);
    const target = this.nextGoal(node);
    const wasHidden = Boolean(node?.hidden);
    const token = ++this.token;
    Object.assign(this, {
      busy: true, goal: target, active: false, finishing: false, lastPx: undefined,
      start: Date.now(), samples: env.props()?.[this.measure] ? [] : null,
    });
    cx.spawn(async taskCx => {
      await taskCx.sleep(LEAVE_RENDER_MS); // leave the render phase: notify() is only legal from a task
      if (token !== this.token) return;
      if (!(await this.prepare(taskCx, env, { token, target, open, wasHidden }))) return;
      this.active = true;
      this.clockPx = (target ? open : 1) / env.zoom();
      taskCx.notify();
      await taskCx.sleep(CLOCK_GUARD_MS);
      if (token !== this.token || !this.busy || this.finishing) return;
      // A native transition that is not interpolating delivers nothing, and the drawer would then
      // sit still until the fallback jumped it to the end. Step the node from a timer instead, so
      // the work area's edge always moves; `size()` is the same path either way.
      if (this.lastPx === undefined) return this.stepByTimer(taskCx, env, token, target, open);
      // The clock's own endpoint callback finishes the drawer. This timer only covers the case
      // where no callback comes.
      await taskCx.sleep(FALLBACK_MS);
      if (token === this.token && this.busy && !this.finishing) this.size({ width: this.clockPx }, taskCx, env);
    });
  }

  // The direction a press goes: a second press reverses a running drawer, otherwise it flips the node.
  nextGoal(node) {
    if (this.busy) return 1 - this.goal;
    return node?.hidden ? 1 : 0;
  }

  // Before the clock starts: hold `main`, and bring a hidden node up from 1px. False when a newer
  // press took over while this one waited.
  async prepare(cx, env, { token, target, open, wasHidden }) {
    const pin = this.pin(open, wasHidden);
    if (pin != null) {
      env.pin(pin);
      await cx.sleep(PIN_SETTLE_MS);
      if (token !== this.token) return false;
    }
    // Expand starts from 1px while hidden, so the node is drawn at its open width on the first
    // visible frame instead of jumping there.
    if (target === 1 && env.find(env.layout(), this.id)?.hidden) {
      env.run("layout.resize", { id: this.id, px: 1 });
      await cx.sleep(RESIZE_SETTLE_MS);
      if (token !== this.token) return false;
      env.run("layout.show", { id: this.id });
      await cx.sleep(SHOW_SETTLE_MS);
      if (token !== this.token) return false;
    }
    return true;
  }

  // The clock never reported: step the node from a timer along the same curve the left sidebar's
  // timer mode uses (smoothstep), feeding `size()` so there is one path for dedupe, hide and finish.
  stepByTimer(cx, env, token, target, open) {
    const to = target ? open : 1;
    const from = Math.max(1, Math.min(open, Math.round(env.find(env.layout(), this.id)?.size?.px ?? to)));
    const ticks = Math.max(1, Math.round(DURATION_MS / STEP_MS));
    cx.spawn(async (stepCx) => {
      for (let i = 1; i <= ticks; i++) {
        const k = i / ticks;
        const eased = k * k * (3 - 2 * k);
        this.size({ width: (from + (to - from) * eased) / env.zoom() }, stepCx, env);
        if (this.finishing) return;
        await stepCx.sleep(STEP_MS);
        if (token !== this.token) return;
      }
    });
  }

  // One clock callback: the node's width this step, in layout px (the clock is in device px, so
  // the person's zoom is divided out).
  size(size, cx, env) {
    if (!this.busy || !this.active || this.finishing) return;
    const open = this.openPx || this.defaultOpen;
    const px = Math.max(1, Math.min(open, Math.round(size.width * env.zoom())));
    this.p = px / open;
    if (px !== this.lastPx) { // each resize repaints the terminals, so never send one that changes nothing
      this.lastPx = px;
      if (this.samples) this.samples.push({ ms: Date.now() - this.start, px });
      env.run("layout.resize", { id: this.id, px });
    }
    // The hide of a reversed collapse can land after the show of an expand: keep the node shown.
    if (this.goal === 1 && env.find(env.layout(), this.id)?.hidden) env.run("layout.show", { id: this.id });
    if (px !== (this.goal ? open : 1)) return;
    this.finishing = true;
    const token = this.token, target = this.goal, start = this.start, samples = this.samples;
    cx.spawn(async finishCx => {
      await finishCx.sleep(LEAVE_RENDER_MS);
      if (token !== this.token) return;
      if (samples) env.write(`/tmp/${this.id}-native-${start}.json`, JSON.stringify({ target, open, samples })).catch(() => {});
      if (target === 0) {
        env.run("layout.hide", { id: this.id });
        await finishCx.sleep(HIDE_SETTLE_MS);
        if (token !== this.token) return;
      }
      // Collapse puts the open width back while hidden, so the next show comes back at that width.
      env.run("layout.resize", { id: this.id, px: open });
      this.after(target);
      this.busy = false;
      env.release();
      this.active = false;
      this.lastPx = undefined;
      finishCx.notify();
    });
  }
}

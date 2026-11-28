type Builder = { name: string; args: unknown[] } & Record<string, (...args: unknown[]) => Builder>;
type InputHandler = (event: unknown, cx: { notify(): void }) => void;
type InputEventName = "change" | "submit" | "focus" | "blur" | "paste_other";
import { agentConfigRuntime } from "../support/agent-config-runtime.js";
import { recordedElement } from "./gpui-recording.js";

function builder(name: string, ...args: unknown[]): Builder {
  if (agentConfigRuntime()) return recordedElement(name, ...args) as unknown as Builder;
  const record = { name, args };
  const proxy: Builder = new Proxy(record as Builder, {
    get(target, key: string) {
      if (key in target) return target[key];
      return (...values: unknown[]) => {
        if (key === "when" && values[0]) (values[1] as (value: Builder) => unknown)(proxy);
        return proxy;
      };
    },
  });
  return proxy;
}

class TextInputState {
  __v: string;
  readonly fns: Partial<Record<InputEventName, InputHandler>> = {};
  private handlers = new Map<InputEventName, InputHandler[]>();

  constructor(value = "") {
    this.__v = value;
  }

  static new(
    options: { placeholder?: string; value?: string; rows?: number } = {},
  ): TextInputState {
    return new TextInputState(options.value);
  }

  value(): string {
    return this.__v;
  }

  set_value(next: string): void {
    this.__v = next;
    this.emit("change");
  }

  set_soft_wrap(): void {}
  focus(): void {
    this.emit("focus");
  }
  on(event: InputEventName, handler: InputHandler): boolean {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    this.fns[event] = handler;
    return true;
  }

  emit(event: InputEventName): void {
    for (const handler of this.handlers.get(event) ?? []) handler({}, { notify() {} });
  }
}

export type ColorTokens = Record<string, `#${string}`>;
export type TextareaState = TextInputState;
export type InputState = TextInputState;
export const v_flex = (): Builder => builder("v_flex");
export const h_flex = (): Builder => builder("h_flex");
export const TextareaState = TextInputState;
export const InputState = TextInputState;
export const Textarea = { new: (state: TextInputState): Builder => builder("Textarea", state) };
export const Input = { new: (state: TextInputState): Builder => builder("Input", state) };
export const Scrollbar = { vertical: (id: string): Builder => builder("Scrollbar.vertical", id) };
export const HoverCard = { new: (id: string): Builder => builder("HoverCard", id) };

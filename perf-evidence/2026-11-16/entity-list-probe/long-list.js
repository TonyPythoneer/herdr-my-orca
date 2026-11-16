import { View, div, list } from "gpui-kit";
import { VirtualListScrollHandle } from "gpui-base";
let rendered = [];
class Row extends View {
  init(props) { this.index = props.index; this.owner = props.owner; }
  render() {
    this.owner.rendered.push(this.index);
    console.log("PROBE child", this.index);
    return div().h(this.index % 2 ? 80 : 40).on_click((_e, cx) => { console.log("PROBE click", this.index); cx.notify(); }).child(`interactive retained row ${this.index}`);
  }
}
export default class Probe extends View {
  init(_, cx) {
    this.rendered = [];
    this.rows = Array.from({length:1000}, (_, index) => cx.new(Row, { index, owner: this }));
    this.scroll = VirtualListScrollHandle.new();
    let ticks = 0;
    cx.timer.every(1000, cx => {
      console.log("PROBE interval", ++ticks, JSON.stringify(this.rendered)); this.rendered = [];
      if (ticks === 3) { this.scroll.scroll_to_item(999); cx.notify(); }
    });
  }
  render() { return list("probe", this.rows.length, i => String(i), i => div().child(this.rows[i])).track_scroll(this.scroll); }
  close() { for (const row of this.rows) row.release(); this.scroll.release(); }
}

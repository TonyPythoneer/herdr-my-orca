import { View, div } from "gpui-kit";
import { VirtualListScrollHandle, v_virtual_list } from "gpui-base";
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
    this.sizes = Array.from({length:1000}, (_, i) => i % 2 ? 80 : 40);
    this.scroll = VirtualListScrollHandle.new();
    let ticks = 0;
    cx.timer.every(1000, cx => {
      console.log("PROBE interval", ++ticks, JSON.stringify(this.rendered)); this.rendered = [];
      if (ticks === 3) { this.scroll.scroll_to_item(999); cx.notify(); }
    });
  }
  render() { return v_virtual_list("probe-v", this.rows.length, this.sizes, i => String(i), range => { const rows = []; for (let i = range.start; i < range.end; i++) rows.push(div().child(this.rows[i])); return rows; }).track_scroll(this.scroll); }
  close() { for (const row of this.rows) row.release(); this.scroll.release(); }
}

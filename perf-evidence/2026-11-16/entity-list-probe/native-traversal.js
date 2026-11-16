import { View, div } from "gpui-kit";
import { VirtualListScrollHandle, v_virtual_list } from "gpui-base";
class Row extends View {
  init(props, cx) { this.focus = cx.focus_handle(); this.update(props); this.owner.handles[this.index] = this.focus; }
  update(props) { this.owner = props.owner; this.index = props.index; this.expanded = props.expanded; }
  render() {
    this.owner.seen.add(this.index);
    return div().h(this.expanded ? 160 : this.index % 2 ? 80 : 40)
      .track_focus(this.focus).tab_index(0)
      .on_size_change((size, cx) => {
        if (this.owner.sizes[this.index] !== size.height) {
          console.log("CALIBRATE", this.index, this.owner.sizes[this.index], size.height);
          this.owner.sizes[this.index] = size.height; this.owner.dirty = true;
        }
      }).on_click((_e, cx) => cx.notify()).child(`measured row ${this.index}${this.expanded ? " expanded" : ""}`);
  }
}
export default class Probe extends View {
  init(_, cx) {
    this.handles = []; this.seen = new Set();
    this.sizes = Array.from({length:1000}, (_, i) => i % 2 ? 80 : 40);
    this.rows = Array.from({length:1000}, (_, index) => cx.new(Row, {index, owner:this}));
    this.scroll = VirtualListScrollHandle.new(); this.scroll.scroll_to_item(999);
    this.stage = 0; this.steps = [];
    cx.timer.every(500, cx => {
      if (this.stage === 0 && this.seen.has(999)) {
        console.log("TRAVERSE seen", JSON.stringify([...this.seen]));
        this.handles[988].focus(); this.stage++;
      } else if (this.stage > 0 && this.stage <= 20) {
        window.focus_prev();
        this.steps.push(this.handles.findIndex(h=>h.is_focused())); this.stage++;
        if (this.stage === 21) console.log("TRAVERSE final", JSON.stringify(this.steps));
      }
    });
  }

  render() { return v_virtual_list("measured", this.rows.length, this.sizes, i=>String(i), range => {const rows=[]; for(let i=range.start;i<range.end;i++) rows.push(div().child(this.rows[i])); return rows;}).track_scroll(this.scroll); }
  close() { for(const row of this.rows) row.release(); for(const handle of this.handles) handle.release(); this.scroll.release(); }
}

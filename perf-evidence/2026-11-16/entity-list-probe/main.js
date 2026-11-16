import { View, div, list } from "gpui-kit";
class Row extends View {
  render() { return div().h(40).on_click(() => {}).child("interactive retained row"); }
}
export default class Probe extends View {
  init(_, cx) { this.row = cx.new(Row); }
  render() { return list("probe", 1, () => "row", () => div().child(this.row)); }
}

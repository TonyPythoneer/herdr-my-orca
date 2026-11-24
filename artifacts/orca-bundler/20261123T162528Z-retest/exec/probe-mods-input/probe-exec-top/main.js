import { View, div } from "gpui-kit";
import { exec } from "herdr";

exec("sh", ["-c", "echo \"$HOME\" > /private/tmp/claude-501/rt-pfb0/marker-top.txt"]);

export default class ProbeTop extends View {
  render() {
    return div().child("probe-top");
  }
}

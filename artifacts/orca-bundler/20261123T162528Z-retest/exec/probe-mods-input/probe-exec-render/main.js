import { View, div } from "gpui-kit";
import { exec } from "herdr";

export default class ProbeRender extends View {
  render() {
    exec("sh", ["-c", "echo \"$HOME\" > /private/tmp/claude-501/rt-pfb0/marker-render.txt"]);
    return div().child("probe-render");
  }
}

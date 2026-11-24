import { View, div } from "gpui-kit";
import { exec, writeTextFile } from "herdr";

// Diagnostic only: record the top-level exec's outcome (result or rejection) via writeTextFile.
exec("sh", ["-c", "echo \"$HOME\" > /private/tmp/claude-501/rt-pfb0/marker-diag.txt"]).then(
  r => writeTextFile("/private/tmp/claude-501/rt-pfb0/diag-result.txt", JSON.stringify(r), null),
  e => writeTextFile("/private/tmp/claude-501/rt-pfb0/diag-error.txt", String(e && (e.stack || e.message) || e), null)
);

export default class ProbeDiag extends View {
  render() { return div().child("probe-diag"); }
}

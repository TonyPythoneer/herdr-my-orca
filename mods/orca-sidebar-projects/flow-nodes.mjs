// Gives flow tests a real recorder node: the stub loader reads the names to export from the
// importing file, so the import has to sit in a file of its own that loads after `flow-host.mjs`.
import { div } from "gpui-kit";

export { div };

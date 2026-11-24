// Checks shared by the file actions that run a shell script on the workspace (rename, create, duplicate,
// delete, save): the action must still target the workspace it was opened for, and a path below the
// workspace root must be made of plain names.
export const sameWorkspace = (target, current) =>
  JSON.stringify({ cwd: target.cwd, on: target.on, space: target.space }) === JSON.stringify(current);

export const hasUnsafePart = (relative) => relative.split("/").some((part) => !part || part === "." || part === "..");

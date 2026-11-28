export function newTabArgs(space: { id?: string; folder?: string } | null | undefined): {
  space?: string;
  folder?: string;
} {
  if (!space?.id) return {};
  return { space: space.id, ...(space.folder ? { folder: space.folder } : {}) };
}

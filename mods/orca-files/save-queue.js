// A document's later snapshot must use the previous successful write as its expected value.
export function queueSave(doc, text, write) {
  const task = (doc.queue ?? Promise.resolve()).then(async () => {
    if (doc.failure) throw doc.failure;
    if (text === doc.disk) return;
    try { await write(doc.full, text, doc.disk); doc.disk = text; }
    catch (e) { doc.failure = e; throw e; }
  });
  doc.queue = task.catch(() => { /* Keep the queue usable; the caller receives the original rejection. */ });
  return task;
}

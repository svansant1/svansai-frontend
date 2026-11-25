/** Coordinate this request's own progress write with its concurrent permission watcher.
 * Never adopt an unrelated revision: the writer must verify its exact append result first.
 */
export async function assertContextRevisionCurrent(
  context: { expectedContextRevision?: number; progressWrite?: Promise<void> },
  readRevision: () => Promise<number>,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await context.progressWrite;
    const expected = context.expectedContextRevision;
    if (expected === undefined) return;
    const actual = await readRevision();
    if (context.progressWrite || expected !== context.expectedContextRevision) continue;
    if (actual !== expected) throw new Error("Investigation context changed. Review and submit again.");
    return;
  }
  throw new Error("Investigation context changed during validation.");
}

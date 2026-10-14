// Final-stage records outlive reusable per-frame capture arrays. Clone every
// nested CTM/rectangle first, then freeze so later QA code cannot rewrite history.
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const snapshotDraws = draws => freeze(structuredClone(draws));

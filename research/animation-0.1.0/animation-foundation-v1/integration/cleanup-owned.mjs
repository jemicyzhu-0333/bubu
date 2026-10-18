/** Finish every independent release before reporting callback failures. */
export function cleanupOwned(operations, label) {
  const errors = [];
  for (const operation of operations) {
    try {
      operation();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, label);
}

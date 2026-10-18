/** Capture the addressing/layout contract of a borrowed Three attribute.
 * Byte edits still use Three's needsUpdate/version contract; changing how bytes
 * are addressed always requires readmission, even without needsUpdate.
 */
export function captureAttributeLayout(a) {
  return (
    a && {
      attribute: a,
      version: a.version,
      count: a.count,
      itemSize: a.itemSize,
      normalized: a.normalized,
      array: a.array,
      data: a.data,
      dataVersion: a.data?.version,
      offset: a.offset,
      stride: a.data?.stride,
      dataCount: a.data?.count,
    }
  );
}
export function sameAttributeLayout(a, s) {
  if (!a || !s) return a === s;
  return (
    a === s.attribute &&
    a.version === s.version &&
    a.count === s.count &&
    a.itemSize === s.itemSize &&
    a.normalized === s.normalized &&
    a.array === s.array &&
    a.data === s.data &&
    a.data?.version === s.dataVersion &&
    a.offset === s.offset &&
    a.data?.stride === s.stride &&
    a.data?.count === s.dataCount
  );
}

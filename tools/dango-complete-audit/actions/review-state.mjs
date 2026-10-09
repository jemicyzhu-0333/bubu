// A capture can supply pixels, but it cannot create a new visual judgment.
export function assessEvidenceReview(bound, current, reviewedAt, note) {
  const expected = bound?.artifacts;
  const reviewed = ['visually-reviewed', 'repaired-and-visually-reviewed'].includes(bound?.review?.status);
  const valid = list => Array.isArray(list) && list.every(value => typeof value.path === 'string' && typeof value.sha256 === 'string')
    && new Set(list.map(value => value.path)).size === list.length;
  const matches = reviewed && valid(expected) && valid(current) && expected.length === current.length
    && current.every(value => expected.some(prior => prior.path === value.path && prior.sha256 === value.sha256));
  return matches ? { ...bound.review, acceptanceHashMatched: true, reviewedAt }
    : { status: 'awaiting-visual-review', acceptanceHashMatched: false, note,
      reason: 'No persisted reviewer outcome matches these exact current PNG/clip inputs' };
}

// ARCHITECTURE「收件分类与原文历史」: unavailable storage is not an empty history.
// One current-category cache follows the feature lifetime; pagination stays user-driven.
function createInboxHistory({ readPage, onChange = () => {} }) {
  let scope = 'pending', category = '', items = [], authoritative = new Map();
  let available = null, partial = false, loading = false, nextCursor = null, total = null, globalTotal = null;
  let request = 0, disposed = false, countVersion;
  const validCount = value => Number.isInteger(value) && value >= 0;
  function view() {
    return Object.freeze({ items: [...items], available, partial, loading, total, globalTotal, nextCursor,
      canRetry: available === false && !loading });
  }
  function publish() { if (!disposed) onChange(); }
  function cancel() { request++; loading = false; authoritative.clear(); }
  function setScope(nextScope, nextCategory = '') {
    if (disposed || (scope === nextScope && category === nextCategory)) return;
    cancel();
    if (category !== nextCategory) {
      items = []; available = null; partial = false; nextCursor = null; total = null;
    }
    scope = nextScope; category = nextCategory;
  }
  function acceptCount(value, version) {
    if (disposed || !Number.isInteger(version) || version < 0 || (countVersion !== undefined && version <= countVersion)) return;
    countVersion = version; globalTotal = validCount(value) ? value : null;
  }
  function merge(previous, incoming) {
    const byId = new Map(previous.map(item => [item.id, item]));
    for (const item of incoming) byId.set(item.id, item);
    return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt || (a.id === b.id ? 0 : a.id < b.id ? -1 : 1));
  }
  function healthyPage(page) {
    return page?.available === true && page.partial === false && Array.isArray(page.items)
      && validCount(page.total) && validCount(page.globalTotal)
      && (page.nextCursor === null || typeof page.nextCursor === 'string');
  }
  async function load(append = false) {
    if (disposed || scope !== 'history') return;
    const continuing = append && available === true && Boolean(nextCursor);
    if (append && loading) return;
    const cursor = continuing ? nextCursor : null;
    const previousAuthority = continuing ? new Map(authoritative) : new Map();
    const ticket = ++request, version = countVersion;
    loading = true; authoritative.clear(); publish();
    let page;
    try { page = await readPage({ cursor, category: category || null }); } catch (_) { page = null; }
    if (disposed || ticket !== request || scope !== 'history') return;
    loading = false;
    if (healthyPage(page)) {
      items = continuing ? merge(items, page.items) : [...page.items];
      available = true; partial = false; total = page.total; nextCursor = page.nextCursor;
      authoritative = new Map([...previousAuthority, ...page.items.map(item => [item.id, item])]);
      if (countVersion === version) globalTotal = page.globalTotal;
    } else {
      // Partial responses contain real local rows. Cache-only rows remain visible but
      // cannot authorize a new associated-source deletion after the archive read failed.
      const local = page?.available === false && page.partial === true && Array.isArray(page.items) ? page.items : [];
      items = merge(items, local); authoritative = new Map(local.map(item => [item.id, item]));
      available = false; partial = local.length > 0; total = null; nextCursor = null;
      if (countVersion === version) globalTotal = null;
    }
    publish();
  }
  function invalidate(matches) {
    if (disposed) return;
    cancel(); items = items.filter(item => !matches(item));
    total = null; globalTotal = null; nextCursor = null; available = null; partial = false;
    publish();
  }
  return Object.freeze({ view, setScope, acceptCount, load,
    findSource(id) { return !disposed && scope === 'history' && !loading ? authoritative.get(id) || null : null; },
    invalidateId(id) { invalidate(item => item.id === id); },
    invalidateMoodSource(moodId) { invalidate(item => item.resolution?.action === 'feeling' && item.resolution.targetId === moodId); },
    suspend() { if (!disposed) { cancel(); publish(); } },
    dispose() { disposed = true; cancel(); items = []; total = null; globalTotal = null; }
  });
}
export { createInboxHistory };

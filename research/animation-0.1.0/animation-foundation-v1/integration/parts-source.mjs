import { cleanupOwned } from "./cleanup-owned.mjs";

const STAGING_BYTES = 32 * 1024 * 1024;

/** One pool owns this source; actors borrow leases, never each other's skeletons.
 * The last consumer releases actual resources as well as the byte claim.
 */
export function createPartsSource({ budget, load, measure, dispose }) {
  let current = null;
  let closed = false;

  function release(entry) {
    entry.references--;
    if (entry.references !== 0) return;
    if (current === entry) current = null;
    const asset = entry.asset;
    entry.asset = null;
    cleanupOwned([
      () => { if (asset) dispose(asset); },
      () => entry.claim?.release(),
    ], "Parts source release failures");
  }

  async function acquire() {
    if (closed) throw new Error("Parts source closed");
    if (!current) {
      const entry = { references: 0, asset: null, claim: null };
      current = entry;
      entry.ready = (async () => {
        entry.claim = budget.reserve(STAGING_BYTES, "shared original parts and parse staging");
        entry.asset = await load();
        entry.claim.commit(measure(entry.asset));
      })();
    }
    const entry = current;
    entry.references++;
    try {
      await entry.ready;
      if (closed) throw new Error("Parts source closed during load");
    } catch (error) {
      try { release(entry); } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Parts load and cleanup failed");
      }
      throw error;
    }
    let live = true;
    return Object.freeze({
      get asset() {
        if (!live) throw new Error("Parts lease released");
        return entry.asset;
      },
      release() {
        if (!live) return;
        live = false;
        release(entry);
      },
    });
  }

  return Object.freeze({
    acquire,
    close() { closed = true; },
    diagnostics() {
      return Object.freeze({
        closed, references: current?.references ?? 0,
        resident: Boolean(current?.asset),
      });
    },
  });
}

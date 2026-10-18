/** Resource-only cache: never owns actor, prop, focus or theme state. Load/dispose are narrow ports.
 * A cancelled last lease evicts immediately; a late result disposes itself, never a newer entry.
 */
export function createEnvironmentPool({load, dispose}) {
  const entries = new Map();
  let liveLeases = 0;
  return Object.freeze({
    acquire(descriptor) {
      const key = `${descriptor.id}@${descriptor.revision}:${descriptor.asset.sha256}`;
      let entry = entries.get(key);
      if (!entry) {
        entry = {refs:0, resource:null, settled:false};
        entries.set(key, entry);
        entry.ready = Promise.resolve().then(() => load(descriptor)).then(resource => {
          entry.settled = true;
          entry.resource = resource;
          if (entry.refs === 0) { dispose(resource); entry.resource = null; }
          return resource;
        }, error => {
          entry.settled = true;
          if (entries.get(key) === entry) entries.delete(key);
          throw error;
        });
      }
      entry.refs++; liveLeases++;
      let released = false;
      return Object.freeze({key, ready:entry.ready,
        release() {
          if (released) return;
          released = true; entry.refs--; liveLeases--;
          if (entry.refs === 0) {
            if (entries.get(key) === entry) entries.delete(key);
            if (entry.resource !== null) { dispose(entry.resource); entry.resource = null; }
          }
        }
      });
    },
    stats: () => ({entries:entries.size,leases:liveLeases})
  });
}

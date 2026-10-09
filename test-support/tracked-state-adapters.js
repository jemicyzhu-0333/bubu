'use strict';

// Each fixture owns every adapter it opens, including reopens. Close SQLite
// handles before removing its directory; POSIX unlink can otherwise hide leaks.
function trackStateAdapters(createAdapter) {
  const byDirectory = new Map();
  return {
    open(options) {
      const adapter = createAdapter(options);
      const opened = byDirectory.get(options.userDataPath) || [];
      opened.push(adapter); byDirectory.set(options.userDataPath, opened);
      return adapter;
    },
    closeDirectory(directory) {
      for (const adapter of byDirectory.get(directory) || []) adapter.close();
      byDirectory.delete(directory);
    }
  };
}
module.exports = { trackStateAdapters };

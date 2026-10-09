'use strict';

const fs = require('node:fs');

// ARCHITECTURE「持久化与迁移」: publishing a byte-exact migration backup
// needs durable directory metadata as well as durable file bytes. Windows' Node
// directory handle is not a verified substitute for a native write-through
// publication adapter. Unsupported directory flushes fail closed on every OS;
// in particular, never turn Windows EPERM/EISDIR/EINVAL into a silent success.
function syncAuthoritativeDirectory({ directory, io = fs, platform = process.platform }) {
  let fd;
  try {
    fd = io.openSync(directory, 'r');
    io.fsyncSync(fd);
  } catch (error) {
    const unsupported = ['EISDIR', 'ENOTSUP', 'ENOSYS', 'EINVAL', 'EBADF'].includes(error?.code)
      || (platform === 'win32' && error?.code === 'EPERM');
    const failure = new Error(unsupported ? 'directory-sync-unsupported' : 'directory-sync-failed');
    failure.code = unsupported ? 'DIRECTORY_SYNC_UNSUPPORTED' : 'DIRECTORY_SYNC_FAILED';
    throw failure;
  } finally {
    if (fd !== undefined) io.closeSync(fd);
  }
}

module.exports = { syncAuthoritativeDirectory };

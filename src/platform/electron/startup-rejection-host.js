'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function createStartupRejectionHost({ appHost, sourcePath, electron = require('electron'), io = fs } = {}) {
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) throw new TypeError('startup-rejection-path-invalid');
  if (appHost.isReady()) throw new Error('startup-rejection-dialog-isolation-required');
  // Match the upgrade dialog's isolation: Chromium must not write into the
  // refused source while its owner reads this explanation. No source is moved.
  const directory = io.mkdtempSync(path.join(os.tmpdir(), 'bubu-startup-dialog-'));
  appHost.setDataDirectory(directory);
  return Object.freeze({ async report(code) {
    await appHost.whenReady();
    await electron.dialog.showMessageBox({ type: 'error', title: '小步 · bubu',
      message: '暂时无法打开这个数据目录 / This data folder could not be opened',
      detail: `小步已停止启动，没有自动重置、迁移或更换数据目录。目录中有无法确认的文件，或数据未通过完整性检查。请保留原目录，不要删除、覆盖或将旧文件混入新目录。重新安装到其他位置不会更换这个数据目录。\n\nStartup has stopped without an automatic reset, migration, or change of data folder. Some files are unrecognized or the data could not be verified. Keep the original folder; do not delete, overwrite, or mix its files into a new profile. Changing the installation folder does not change this data folder.\n\n数据目录 / Data folder: ${sourcePath}\n错误代码 / Error code: ${code}`,
      buttons: ['退出 / Quit'], defaultId: 0, cancelId: 0, noLink: true });
  } });
}

module.exports = { createStartupRejectionHost };

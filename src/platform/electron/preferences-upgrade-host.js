'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function profileRelaunchArguments(argv, sourcePath) {
  if (!Array.isArray(argv) || typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) throw new TypeError('config-upgrade-relaunch-invalid');
  const args = [];
  for (let index = 1; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--user-data-dir') { index++; continue; }
    if (typeof argument !== 'string') throw new TypeError('config-upgrade-relaunch-invalid');
    if (!argument.startsWith('--user-data-dir=')) args.push(argument);
  }
  return [...args, `--user-data-dir=${sourcePath}`];
}
function createPreferencesUpgradeHost({ appHost, sourcePath, argv = process.argv, electron = require('electron'), io = fs } = {}) {
  const restartArguments = profileRelaunchArguments(argv, sourcePath);
  // The source profile lock is already held. Keep Chromium's readiness/cache
  // writes away from that profile while the owner is deciding whether to upgrade.
  if (appHost.isReady()) throw new Error('config-upgrade-dialog-isolation-required');
  const directory = io.mkdtempSync(path.join(os.tmpdir(), 'bubu-upgrade-dialog-'));
  appHost.setDataDirectory(directory);
  const { app, dialog } = electron;
  async function confirm(upgrade) {
    await appHost.whenReady();
    const result = await dialog.showMessageBox({ type: 'question', title: '小步 · bubu',
      message: '为语言与外观设置升级数据 / Upgrade data for language and appearance',
      detail: `已核验此 bubu 档案（18 → 19）。升级前会建立完整私有备份，只添加语言与主题设置。旧版不能直接打开升级后的数据。\n\nVerified bubu profile (18 → 19). A complete private backup is required before adding language and theme preferences. Earlier versions cannot open the upgraded profile.\n\n档案 / Profile: ${upgrade.sourcePath}\n备份 / Backup: ${upgrade.backupPath}\n\n备份可能含私密内容，请妥善保存。 / The backup may contain private information. Keep it private.`,
      buttons: ['退出 / Quit', '备份并升级 / Back up and upgrade'], defaultId: 0, cancelId: 0,
      noLink: true, checkboxLabel: '已了解需保留备份 / I understand the backup must be kept', checkboxChecked: false });
    return result.response === 1 && result.checkboxChecked === true;
  }
  async function report(result, error) {
    await appHost.whenReady();
    await dialog.showMessageBox({ type: error ? 'error' : 'info', title: '小步 · bubu',
      message: error ? '升级未完成验证 / Upgrade not verified' : '升级已完成 / Upgrade complete',
      detail: error
        ? `数据档案与已产生的备份均保留。请重开应用核验，不要覆盖原档或用旧版打开。\nThe profile and any backup are retained. Reopen bubu to verify; do not overwrite the profile or open it with an older version.\n\n${String(error.code || error.message || 'config-upgrade-failed').slice(0, 160)}\n${error.backupPath || result?.backupPath || ''}`
        : `即将重新打开小步。备份保留在：\nbubu will reopen. The backup is retained at:\n${result.backupPath}`,
      buttons: ['确定 / OK'], defaultId: 0, cancelId: 0, noLink: true });
  }
  return Object.freeze({ confirm, report, restart: () => app.relaunch({ args: [...restartArguments] }) });
}
module.exports = { createPreferencesUpgradeHost, profileRelaunchArguments };

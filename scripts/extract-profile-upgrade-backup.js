'use strict';
const path = require('node:path');
const { extractProfileUpgradeBackup } = require('../src/platform/persistence/sqlite/sqlite-database');
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--backup' || args[2] !== '--new-directory') {
  process.stderr.write('Usage: node scripts/extract-profile-upgrade-backup.js --backup /absolute/profile-backup.sqlite --new-directory /absolute/new-profile\nClose bubu first. The destination must not already exist. Nothing is overwritten.\n');
  process.exitCode = 2;
} else {
  try {
    if (!path.isAbsolute(args[1]) || !path.isAbsolute(args[3])) throw Error('Use explicit absolute paths.');
    const result = extractProfileUpgradeBackup({ backupFile: args[1], destination: args[3] });
    process.stdout.write(`Verified schema18 backup extracted to ${result.destination}. Keep the backup. No running profile was switched.\n`);
  } catch (error) { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; }
}

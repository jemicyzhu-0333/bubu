'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOTS = ['src', 'test', 'test-support', 'scripts', 'tools'];
function syntaxFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && !['node_modules', '.git'].includes(entry.name)) visit(file);
      else if (entry.isFile() && /\.(?:js|mjs|cjs)$/.test(entry.name)) files.push(file);
    }
  }
  for (const name of ROOTS) if (fs.existsSync(path.join(root, name))) visit(path.join(root, name));
  return files;
}
function run(root = path.resolve(__dirname, '..')) {
  for (const file of syntaxFiles(root)) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.error || result.status !== 0) return result.status || 1;
  }
  return 0;
}
if (require.main === module) process.exitCode = run();
module.exports = { syntaxFiles, run };

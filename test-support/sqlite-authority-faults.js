'use strict';
const { DatabaseSync } = require('node:sqlite');
const { openSqliteConfigAuthority } = require('../src/platform/persistence/sqlite/config-authority-database');
function faultFactory(fault, observed = { open: 0 }) {
  return options => openSqliteConfigAuthority(options, {
    selectDriver: () => ({ open(filePath, settings = {}) {
      fault({ type: 'open', filePath, readOnly: settings.readOnly === true });
      const db = new DatabaseSync(filePath, settings); observed.open++;
      return { db, filePath, readOnly: settings.readOnly === true };
    } }),
    makeHandle: ({ db, filePath, readOnly }) => ({
      exec(sql) { fault({ type: 'before', sql, filePath, readOnly }); const result = db.exec(sql); fault({ type: 'after', sql, filePath, readOnly }); return result; },
      run(sql, params = []) { fault({ type: 'before', sql, filePath, readOnly }); const result = db.prepare(sql).run(...params); fault({ type: 'after', sql, filePath, readOnly }); return result; },
      get: (sql, params = []) => db.prepare(sql).get(...params), all: (sql, params = []) => db.prepare(sql).all(...params),
      userVersion: () => db.prepare('PRAGMA user_version').get().user_version,
      setUserVersion: version => db.exec(`PRAGMA user_version=${version}`),
      close() { db.close(); observed.open--; }
    })
  });
}
module.exports = { faultFactory };

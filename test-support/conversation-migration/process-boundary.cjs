'use strict';
const { open, ports, snapshot, OWNER } = require('./migration-fixture.cjs');
const [filePath, stage, phase, mode] = process.argv.slice(2);
const p = ports(e => { if (e.stage === stage && e.sql === 'COMMIT' && e.phase === phase) process.exit(73); });
const result = open(filePath, p);
if (stage === 'business' && result.status === 'available') {
  const record = snapshot();
  if (mode === 'existing') { record.revision++; record.updatedAt++; record.inputDraft += ' exact attempted successor'; }
  const save = result.repository.saveSnapshot({ ownerId: OWNER, snapshot: record,
    expectedRevision: mode === 'existing' ? record.revision - 1 : 0, now: record.updatedAt });
  console.error(JSON.stringify({ unexpectedSaveReturn: save }));
}
result.close();
console.error(JSON.stringify({ boundaryNotReached: { stage, phase }, status: result.status, reason: result.reason }));
process.exit(74);

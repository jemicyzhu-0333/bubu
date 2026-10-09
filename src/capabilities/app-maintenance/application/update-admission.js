'use strict';

// One process-local installation lease. It is never persisted and never grants
// an install by itself; the caller must acquire, revalidate, and hand off explicitly.
function createUpdateAdmission() {
  let owner = null, pending = 0;
  const isBlocked = () => owner !== null;
  function assertOpen() { if (isBlocked()) throw new Error('application-updating'); }
  function acquire() {
    assertOpen();
    if (pending !== 0) throw new Error('pending-operation');
    const token = {}; owner = token;
    return Object.freeze({ release() { if (owner === token) owner = null; } });
  }
  function beginOperation() {
    assertOpen(); pending += 1; let finished = false;
    return Object.freeze({ release() { if (!finished) { finished = true; pending -= 1; } } });
  }
  function protectRepository(repository) {
    return Object.freeze({ ...repository, writesBlocked: isBlocked,
      commit(...args) { assertOpen(); return repository.commit(...args); },
      update(...args) { assertOpen(); return repository.update(...args); }
    });
  }
  return Object.freeze({ isBlocked, assertOpen, acquire, beginOperation, canRestart: () => pending === 0, protectRepository });
}
module.exports = { createUpdateAdmission };

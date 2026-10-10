'use strict';
// Narrow observational port; it cannot authorize work or turn an accepted result into failure.
function beginDiagnostic(diagnostics, task, reference) {
  try { return diagnostics?.begin(task, reference) || null; } catch (_) { return null; }
}
function observeDiagnostic(run, phase, data) {
  try { run?.observe(phase, data); } catch (_) { /* Observation is not execution. */ }
}
function finishDiagnostic(run, result, successCode) {
  try { run?.finish(result?.changed === true ? successCode
    : result?.reason || (result ? 'not-applied' : 'application-outcome-unknown'),
  typeof result?.changed === 'boolean' ? result.changed : null); } catch (_) { /* No retry. */ }
}
module.exports = { beginDiagnostic, observeDiagnostic, finishDiagnostic };

'use strict';
const { themeLedger: { createLedger } } = require('../capabilities/companion');
const { createThemeCommitAdapter } = require('./theme-commit-adapter');
const defaultRegistry = require('../content/theme-source-registry');
function createThemeStateRuntime({ clock, registry = defaultRegistry, namespace = 'bubu:canonical-commits', reportError = () => {} }) {
  const ledger = createLedger({ schemaVersion:2, namespaces:[namespace], maxRecords:4096,
    mappings:registry.mappings, capabilities:registry.capabilities });
  const adapter = createThemeCommitAdapter({ ledger, namespace, clock, registry, reportError });
  return Object.freeze({ publishCommitted:adapter.publishCommitted,
    resolveMappingVersion:adapter.resolveMappingVersion, project:() => ledger.project(clock.now()) });
}
module.exports = { createThemeStateRuntime };

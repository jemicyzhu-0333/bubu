'use strict';

const work = require('../../capabilities/work');
const execution = require('../../capabilities/execution');
const guidance = require('../../capabilities/guidance');
const companion = require('../../capabilities/companion');
const attention = require('../../capabilities/attention');
const preferences = require('../../capabilities/preferences');
const progress = require('../../capabilities/progress');
const routines = require('../../capabilities/routines');
const appMaintenance = require('../../capabilities/app-maintenance');
const { PayloadValidationError } = require('../../shared/ipc-validation');

const ipcRoutes = Object.freeze([
  ...work.ipcRoutes,
  ...execution.ipcRoutes,
  ...guidance.ipcRoutes,
  ...companion.ipcRoutes,
  ...attention.ipcRoutes,
  ...preferences.ipcRoutes,
  ...progress.ipcRoutes,
  ...routines.ipcRoutes,
  ...appMaintenance.ipcRoutes
]);

const routesByChannel = new Map();
for (const route of ipcRoutes) {
  if (routesByChannel.has(route.channel)) throw new Error(`Duplicate IPC route: ${route.channel}`);
  routesByChannel.set(route.channel, route);
}

function routeFor(channel) {
  return routesByChannel.get(channel) || null;
}

function allowedSurfacesFor(channel) {
  const route = routeFor(channel);
  return route ? [...route.surfaces] : [];
}

function validateIpcPayload(channel, payload, context = {}) {
  const route = routeFor(channel);
  return route
    ? route.decode(payload, context)
    : { ok: false, errors: [`unsupported channel: ${channel}`] };
}

function assertIpcPayload(channel, payload, context = {}) {
  const result = validateIpcPayload(channel, payload, context);
  if (!result.ok) throw new PayloadValidationError(channel, result.errors);
  return result.value;
}

module.exports = {
  ipcRoutes,
  routeFor,
  allowedSurfacesFor,
  validateIpcPayload,
  assertIpcPayload,
  PayloadValidationError
};

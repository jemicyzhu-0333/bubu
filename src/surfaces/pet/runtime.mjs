'use strict';

import { createPetController } from './controller.mjs';

function requireEnvironment(environment) {
  if (!environment || !environment.window || !environment.document) {
    throw new TypeError('pet runtime environment is required');
  }
  if (typeof environment.requestAnimationFrame !== 'function') {
    throw new TypeError('pet runtime requires requestAnimationFrame');
  }
  return environment;
}

function requireClients(clients) {
  if (!clients || typeof clients !== 'object') throw new TypeError('pet runtime client is required');
  return clients;
}

export function createPetRuntime({ environment, clients } = {}) {
  return createPetController({
    environment: requireEnvironment(environment),
    clients: requireClients(clients)
  });
}

export default Object.freeze({ createPetRuntime });

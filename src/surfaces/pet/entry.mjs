'use strict';

import { createPetRuntime } from './runtime.mjs';
import { createPetSurfaceClient } from './adapter/surface-client.mjs';

const environment = globalThis;
const runtime = createPetRuntime({
  environment,
  clients: createPetSurfaceClient()
});
runtime.start();

export { runtime };

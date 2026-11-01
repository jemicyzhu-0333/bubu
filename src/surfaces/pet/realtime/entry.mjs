import { createPetSurfaceClient } from '../adapter/surface-client.mjs';
import { createRealtimePetSurface } from './surface.mjs';
const surface = createRealtimePetSurface({ environment: globalThis, clients: createPetSurfaceClient(),
  loadStage: async options => (await import('./three-stage.mjs')).createThreeStage(options) });
await surface.start();
export { surface };

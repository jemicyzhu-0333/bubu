'use strict';

import { createImpulseSurfaceClient } from './adapter/surface-client.mjs';
import { createQuickPanelFeature } from './quick-panel.mjs';

const feature = createQuickPanelFeature({
  window,
  document,
  client: createImpulseSurfaceClient()
});

feature.mount();
window.addEventListener('pagehide', () => feature.dispose(), { once: true });

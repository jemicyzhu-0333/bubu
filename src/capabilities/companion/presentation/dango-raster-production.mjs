'use strict';

import { DANGO_WALK_WORKBENCH } from '../../../content/companion/gait/dango-walk.mjs';
import { DANGO_RASTER } from '../../../../assets/companion/dango/raster/dango.raster.mjs';
import { createDangoRasterArtist } from './dango-raster-art.mjs';
import { createDangoLimbSource } from './dango-limb-assets.mjs';
import { browserImageLoader } from './raster/source.mjs';
import { DANGO_LIMB_RIG } from '../../../content/companion/dango-limbs.mjs';

// One bundled source and cache serve every Dango surface. The factory remains
// injectable for pixel audits; production loading uses the browser image port.
// User reviewed the breathing/stride baseline and accepted this narrow lift timing.
// Scope is enforced by the artist; the rejected authored run clip stays absent.
// limbs v2 (assets/companion/dango/raster/limbs/limbs.json): loaded lazily on
// ready(); absent/invalid/failed keeps the legacy paw sprites. The host accepts
// the contract via DANGO_LIMB_RIG.hostAcceptsContract (2: enabled; per-action
// reach gate plus DANGO_LIMB_RIG.visibleDefects keep defective pairs legacy).
const limbs = createDangoLimbSource({ baseUrl: DANGO_RASTER.baseUrl, loadImage: browserImageLoader, acceptContract: DANGO_LIMB_RIG.hostAcceptsContract });
export default createDangoRasterArtist({ manifest: DANGO_RASTER, runFootTiming: 'forward-recovery', limbs,
  walkPreview: { enabled: DANGO_WALK_WORKBENCH.enabled, workbench: true } });

'use strict';

import { DANGO_RASTER } from '../../../../assets/companion/dango/raster/dango.raster.mjs';
import { createDangoRasterArtist } from './dango-raster-art.mjs';

// One bundled source and cache serve every Dango surface. The factory remains
// injectable for pixel audits; production loading uses the browser image port.
// User reviewed the breathing/stride baseline and accepted this narrow lift timing.
// Scope is enforced by the artist; the rejected authored run clip stays absent.
export default createDangoRasterArtist({ manifest: DANGO_RASTER, runFootTiming: 'forward-recovery' });

import { createDangoRasterFixture } from './dango-raster-geometry.mjs';
import { createDangoRecordingContext } from './dango-recording-context.mjs';

export function rasterFixture() { return createDangoRasterFixture({ contactTools: true }); }
export function recordingContext() { return createDangoRecordingContext({ pathDrawing: true }); }

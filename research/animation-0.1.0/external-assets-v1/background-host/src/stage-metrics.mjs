// PET_VISUAL「舞台与坐标契约」: fixed body sizing, independent hit region.
const positive = (n, key) => {
  if (!Number.isFinite(n) || n <= 0) throw new RangeError(key);
};
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = a => { const n = Math.hypot(...a); positive(n, 'camera basis'); return a.map(v => v/n); };
const vec = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);

/** Pure; projectedBodyWorldWidth and floorY must come from the accepted actor calibration. */
export function stageMetrics({width, height, dpr = 1, dprCap = 2, previewScale = 1,
  projectedBodyWorldWidth, actorAnchor, floorY, cameraPosition = [2, 1.3, 4],
  cameraTarget = [0, .6, 0], near = .01, far = 20, safeInset = 0}) {
  for (const [key, n] of Object.entries({dpr, dprCap, previewScale, projectedBodyWorldWidth, near, far})) positive(n, key);
  if (![width, height, floorY, safeInset].every(Number.isFinite) || width < 0 || height < 0 || safeInset < 0) throw new RangeError('viewport/floor');
  if (!vec(actorAnchor) || !vec(cameraPosition) || !vec(cameraTarget) || far <= near) throw new RangeError('calibration');
  if (width === 0 || height === 0) return freeze({status: 'deferred', reason: 'zero-viewport'});
  // Snapshot input before closures: caller mutation must not bypass atomic resize.
  actorAnchor = [...actorAnchor];
  const backward = unit(sub(cameraPosition, cameraTarget));
  const right = unit(cross([0, 1, 0], backward));
  const up = unit(cross(backward, right));
  const scale = previewScale, ppu = 99 * scale / projectedBodyWorldWidth;
  const origin = [(width - 220*scale)/2, (height - 220*scale)/2];
  const center = [width/2, height/2 + 2*scale];
  const rect = (x,y,w,h) => ({x:origin[0]+x*scale, y:origin[1]+y*scale, width:w*scale, height:h*scale});
  const effectiveDPR = Math.min(dpr, dprCap);
  const project = world => {
    if (!vec(world)) throw new RangeError('world');
    const delta = sub(world, actorAnchor);
    return [center[0] + dot(delta, right)*ppu, center[1] - dot(delta, up)*ppu, dot(delta, backward)];
  };
  const unproject = ([x,y,depth = 0]) => {
    if (![x,y,depth].every(Number.isFinite)) throw new RangeError('screen');
    return actorAnchor.map((v,i) => v + right[i]*(x-center[0])/ppu - up[i]*(y-center[1])/ppu + backward[i]*depth);
  };
  const canvas = rect(.5,2.5,219,219);
  const safe = {left:Math.max(0,canvas.x)+safeInset, top:Math.max(0,canvas.y)+safeInset,
    right:Math.min(width,canvas.x+canvas.width)-safeInset, bottom:Math.min(height,canvas.y+canvas.height)-safeInset};
  return freeze({version:1, status:'ready', viewport:{width,height}, effectiveDPR,
    backing:{width:Math.max(1,Math.round(width*effectiveDPR)),height:Math.max(1,Math.round(height*effectiveDPR))},
    bodyCssWidth:99*scale, pixelsPerWorldUnit:ppu, actorCanvas:canvas,
    // V1 sceneCanvas is offset -20/-30 inside the 18/27 scene frame.
    backgroundCanvas:rect(-2,-3,220,220), backgroundFrame:rect(18,27,184,148),
    actorAnchor: [...actorAnchor], actorScreenAnchor:center, hitRegion:rect(57.5,59.5,105,105),
    floor:{normal:[0,1,0], constant:-floorY, anchor:[actorAnchor[0],floorY,actorAnchor[2]], screenAnchor:project([actorAnchor[0],floorY,actorAnchor[2]])},
    safeRegion:safe, clippingBounds:{left:0,top:0,right:width,bottom:height},
    camera:{profile:'preserved-camera-basis-candidate-calibration',
      position:actorAnchor.map((v,i) => v + cameraPosition[i]-cameraTarget[i]), target:[...actorAnchor],
      basis:{right,up,backward},frustum:{near,far,left:-width/(2*ppu),right:width/(2*ppu),top:center[1]/ppu,bottom:-(height-center[1])/ppu}},
    project,unproject});
}

/** Adapter port must synchronously swap a complete prepared backing/projection/hit bundle or throw without mutation. */
export function createStageResizeHost({prepare, atomicSwap}) {
  let current = null, generation = 0, closed = false;
  return Object.freeze({
    resize(input) {
      if (closed) throw new Error('STAGE_DISPOSED');
      const next = stageMetrics(input);
      if (next.status === 'deferred') return next;
      const bundle = prepare(next);
      try { atomicSwap(bundle, next, generation+1); }
      catch (error) { bundle.release(); throw error; }
      const previous = current;
      current = {metrics:next,bundle}; generation++;
      previous?.bundle.release();
      return {status:'committed',generation,metrics:next};
    },
    snapshot: () => current?.metrics ?? null,
    dispose() { if (closed) return; closed = true; current?.bundle.release(); current = null; }
  });
}

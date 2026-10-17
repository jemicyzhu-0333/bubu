'use strict';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function createPetCompositor({
  context,
  faceSurface,
  spriteCache,
  getGeometry,
  getBodyKey,
  paintBody,
  paintFace
} = {}) {
  if (!context || !faceSurface || !spriteCache) throw new TypeError('pet compositor surfaces are required');
  const resolveGeometry = requireFunction(getGeometry, 'getGeometry');
  const resolveBodyKey = requireFunction(getBodyKey, 'getBodyKey');
  const paintBodySprite = requireFunction(paintBody, 'paintBody');
  const paintFaceSprite = requireFunction(paintFace, 'paintFace');

  function acquireBodySprite(palette, bodyTone, bodyVariant = 'front') {
    const geometry = resolveGeometry();
    const pixels = geometry.bodySize * geometry.deviceScale;
    return spriteCache.acquire(resolveBodyKey(bodyTone, bodyVariant), {
      width: pixels,
      height: pixels,
      paint: surface => paintBodySprite(surface, palette, bodyTone, geometry, bodyVariant)
    });
  }

  function drawBody(palette, bodyTone, offX, offY, bodyVariant = 'front') {
    const geometry = resolveGeometry();
    const sprite = acquireBodySprite(palette, bodyTone, bodyVariant);
    context.drawImage(sprite, offX, offY, geometry.bodySize, geometry.bodySize);
    return sprite;
  }

  function drawFace(palette, face, blinking, offX, offY, view = 'front') {
    const geometry = resolveGeometry();
    const eyes = paintFaceSprite(faceSurface, palette, face, blinking, { ...geometry, view });
    context.drawImage(faceSurface, offX, offY, geometry.bodySize, geometry.bodySize);
    return eyes;
  }

  function snapOrigin(x, y, deviceScale) {
    const scale = Number(deviceScale);
    if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('deviceScale must be positive');
    return Object.freeze({
      x: Math.round(x * scale) / scale,
      y: Math.round(y * scale) / scale
    });
  }

  function compose({ clear, drawBack, drawBodyLayer, drawFaceLayer, drawFront } = {}) {
    if (typeof clear === 'function') clear();
    if (typeof drawBack === 'function') drawBack();
    if (typeof drawBodyLayer === 'function') drawBodyLayer();
    if (typeof drawFaceLayer === 'function') drawFaceLayer();
    if (typeof drawFront === 'function') drawFront();
  }

  return Object.freeze({ acquireBodySprite, drawBody, drawFace, snapOrigin, compose });
}

export { createPetCompositor };
export default Object.freeze({ createPetCompositor });

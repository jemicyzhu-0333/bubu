'use strict';

const { ID_PATTERN } = require('./companion-state');
const { PET_ACTIONS } = require('../content/behaviors.mjs');

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_ASSET_BYTES = 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_CUES = 256;
const MAX_VARIANTS_PER_CUE = 8;
const KNOWN_ANIMATIONS = Object.freeze(new Set(['static-pose', ...Object.keys(PET_ACTIONS)]));
const CUE_KINDS = Object.freeze(new Set(['attention', 'ambient']));
const COOLDOWN_FIELDS = Object.freeze(new Set([
  'globalCooldownMs', 'familyCooldownMs', 'cooldownMs'
]));
const SAFE_ASSET_PATH = /^assets\/[a-z0-9][a-z0-9._/-]{0,199}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${label} has unknown field ${key}`);
  }
  return true;
}

function validInteger(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function validateContentManifest(manifest) {
  const errors = [];
  let encodedSize = Number.POSITIVE_INFINITY;
  try { encodedSize = Buffer.byteLength(JSON.stringify(manifest), 'utf8'); } catch (_) {}
  if (encodedSize > MAX_MANIFEST_BYTES) errors.push(`manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);
  if (!exactKeys(manifest, ['version', 'packId', 'assets', 'cues'], 'manifest', errors)) {
    return { ok: false, errors };
  }
  if (manifest.version !== 1) errors.push('manifest.version must be 1');
  if (typeof manifest.packId !== 'string' || !ID_PATTERN.test(manifest.packId)) errors.push('manifest.packId is invalid');

  const assetIds = new Set();
  let totalAssetBytes = 0;
  if (!Array.isArray(manifest.assets) || manifest.assets.length > 64) {
    errors.push('manifest.assets must contain at most 64 entries');
  } else {
    manifest.assets.forEach((asset, index) => {
      if (!exactKeys(asset, ['id', 'path', 'byteSize'], `asset[${index}]`, errors)) return;
      if (typeof asset.id !== 'string' || !ID_PATTERN.test(asset.id)) errors.push(`asset[${index}].id is invalid`);
      else if (assetIds.has(asset.id)) errors.push(`duplicate asset id: ${asset.id}`);
      else assetIds.add(asset.id);
      if (typeof asset.path !== 'string' || !SAFE_ASSET_PATH.test(asset.path)
          || asset.path.includes('..') || asset.path.includes('://') || asset.path.includes('\\')) {
        errors.push(`asset[${index}].path is unsafe`);
      }
      if (!validInteger(asset.byteSize, 0, MAX_ASSET_BYTES)) errors.push(`asset[${index}].byteSize is invalid`);
      else totalAssetBytes += asset.byteSize;
    });
  }
  if (totalAssetBytes > MAX_TOTAL_ASSET_BYTES) errors.push(`asset bytes exceed ${MAX_TOTAL_ASSET_BYTES}`);

  const cueIds = new Set();
  if (!Array.isArray(manifest.cues) || manifest.cues.length < 1 || manifest.cues.length > MAX_CUES) {
    errors.push(`manifest.cues must contain 1 to ${MAX_CUES} entries`);
  } else {
    manifest.cues.forEach((cue, cueIndex) => {
      if (!exactKeys(cue, [
        'id', 'familyId', 'kind', 'weight', 'priority', 'cost', 'globalCooldownMs',
        'familyCooldownMs', 'cooldownMs', 'focusAllowed', 'discoveryId', 'variants'
      ], `cue[${cueIndex}]`, errors)) return;
      if (typeof cue.id !== 'string' || !ID_PATTERN.test(cue.id)) errors.push(`cue[${cueIndex}].id is invalid`);
      else if (cueIds.has(cue.id)) errors.push(`duplicate cue id: ${cue.id}`);
      else cueIds.add(cue.id);
      if (typeof cue.familyId !== 'string' || !ID_PATTERN.test(cue.familyId)) errors.push(`cue[${cueIndex}].familyId is invalid`);
      if (!CUE_KINDS.has(cue.kind)) errors.push(`cue[${cueIndex}].kind is invalid`);
      for (const field of ['weight', 'priority', 'cost', 'globalCooldownMs', 'familyCooldownMs', 'cooldownMs']) {
        const cooldown = COOLDOWN_FIELDS.has(field);
        if (!validInteger(cue[field], cooldown ? 0 : 1, cooldown ? 86_400_000 : 1_000_000)) {
          errors.push(`cue[${cueIndex}].${field} is invalid`);
        }
      }
      if (typeof cue.focusAllowed !== 'boolean') errors.push(`cue[${cueIndex}].focusAllowed must be boolean`);
      if (cue.discoveryId !== null && (typeof cue.discoveryId !== 'string' || !ID_PATTERN.test(cue.discoveryId))) {
        errors.push(`cue[${cueIndex}].discoveryId is invalid`);
      }
      const variantIds = new Set();
      if (!Array.isArray(cue.variants) || cue.variants.length < 1 || cue.variants.length > MAX_VARIANTS_PER_CUE) {
        errors.push(`cue[${cueIndex}].variants is invalid`);
        return;
      }
      cue.variants.forEach((variant, variantIndex) => {
        if (!exactKeys(variant, ['id', 'animationId', 'message', 'durationMs', 'assetIds', 'static'], `cue[${cueIndex}].variant[${variantIndex}]`, errors)) return;
        if (typeof variant.id !== 'string' || !ID_PATTERN.test(variant.id)) errors.push(`cue[${cueIndex}].variant[${variantIndex}].id is invalid`);
        else if (variantIds.has(variant.id)) errors.push(`duplicate variant id in ${cue.id}: ${variant.id}`);
        else variantIds.add(variant.id);
        if (!KNOWN_ANIMATIONS.has(variant.animationId)) errors.push(`unknown animation: ${variant.animationId}`);
        if (typeof variant.message !== 'string' || variant.message.length > 120) errors.push(`cue[${cueIndex}].variant[${variantIndex}].message is invalid`);
        if (!validInteger(variant.durationMs, 250, 60_000)) errors.push(`cue[${cueIndex}].variant[${variantIndex}].durationMs is invalid`);
        if (typeof variant.static !== 'boolean') errors.push(`cue[${cueIndex}].variant[${variantIndex}].static must be boolean`);
        if (!Array.isArray(variant.assetIds) || variant.assetIds.length > 8
            || variant.assetIds.some(id => typeof id !== 'string' || !ID_PATTERN.test(id))) {
          errors.push(`cue[${cueIndex}].variant[${variantIndex}].assetIds is invalid`);
        } else {
          for (const assetId of variant.assetIds) {
            if (!assetIds.has(assetId)) errors.push(`unknown asset id: ${assetId}`);
          }
        }
      });
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: manifest };
}

function lintContentManifest(manifest) {
  const result = validateContentManifest(manifest);
  if (!result.ok) throw new TypeError(`Invalid content manifest: ${result.errors.join('; ')}`);
  return manifest;
}

const EGG_MESSAGES = Object.freeze({
  workout: '💪 一二一二！',
  'chase-butterfly': '蝴蝶！等等我！',
  hiccup: '嗝~ 嗝~',
  juggle: '看我杂技！',
  'carry-energy': '⚡ 借过借过',
  'pit-fall': '啊！我不是故意的',
  'mirror-meet': '嗨...另一个我？',
  sing: '~ ♪ ♫ ~',
  'stuck-corner': '装死ing',
  'chase-laser': '光光光！追上你！',
  'dig-treasure': '这里好像有一枚收藏',
  yawn: 'yaaaawn~',
  sneeze: 'HATCHOO!',
  'bubble-blow': '看我吹泡泡',
  meditate: '🧘 冥想中'
});

function familyForLegacyEgg(id) {
  if (['yawn', 'meditate'].includes(id)) return 'ambient.calm';
  if (['hiccup', 'sneeze'].includes(id)) return 'attention.expression';
  if (['workout', 'chase-butterfly', 'pit-fall', 'stuck-corner', 'chase-laser'].includes(id)) return 'attention.motion';
  if (id === 'dig-treasure') return 'attention.discovery';
  return 'attention.performance';
}

function adaptLegacyPetContent(content) {
  const eggs = content && Array.isArray(content.EASTER_EGGS) ? content.EASTER_EGGS : [];
  const cues = eggs.map(egg => {
    const ambient = egg.kind === 'ambient' || ['yawn', 'meditate'].includes(egg.id);
    const message = Array.isArray(egg.lines) && egg.lines.length
      ? String(egg.lines[0])
      : EGG_MESSAGES[egg.id] || String(egg.name || egg.id);
    const durationMs = Math.max(6_000, Math.min(60_000, Math.round(egg.duration)));
    const variants = [
      {
        id: 'default', animationId: egg.id, message,
        durationMs,
        assetIds: [], static: false
      },
      {
        id: 'static', animationId: 'static-pose', message,
        durationMs,
        assetIds: [], static: true
      }
    ];
    if (egg.id === 'meditate') {
      variants.push({
        id: 'focus', animationId: 'meditate', message: '',
        durationMs,
        assetIds: [], static: true
      });
    }
    return {
      id: `egg.${egg.id}`,
      familyId: egg.familyId || familyForLegacyEgg(egg.id),
      kind: ambient ? 'ambient' : 'attention',
      weight: Math.max(1, Math.round(Number(egg.weight || Number(egg.prob || 0.001) * 100_000))),
      priority: Number.isInteger(egg.priority) ? egg.priority : ambient ? 10 : 20,
      cost: 1,
      globalCooldownMs: 30_000,
      familyCooldownMs: ambient ? 10 * 60_000 : 20 * 60_000,
      cooldownMs: 60 * 60_000,
      focusAllowed: egg.focusAllowed === true || egg.id === 'meditate',
      discoveryId: egg.discoveryId || (egg.id === 'dig-treasure' ? 'builtin-core.dig-treasure' : null),
      variants
    };
  });
  return lintContentManifest({ version: 1, packId: 'builtin-core', assets: [], cues });
}

function indexContentManifest(manifest) {
  lintContentManifest(manifest);
  return new Map(manifest.cues.map(cue => [cue.id, cue]));
}

module.exports = {
  MAX_MANIFEST_BYTES,
  MAX_ASSET_BYTES,
  MAX_TOTAL_ASSET_BYTES,
  KNOWN_ANIMATIONS,
  validateContentManifest,
  lintContentManifest,
  adaptLegacyPetContent,
  indexContentManifest
};

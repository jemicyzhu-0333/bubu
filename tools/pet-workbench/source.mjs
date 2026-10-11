import * as renderer from '../../src/surfaces/pet/renderer.mjs';
import * as compositor from '../../src/surfaces/pet/compositor.mjs';
import * as scene from '../../src/surfaces/pet/scene.mjs';
import * as effects from '../../src/surfaces/pet/effects.mjs';
import * as frame from '../../src/surfaces/pet/frame-context.mjs';
import * as forms from '../../src/capabilities/companion/form-registry.mjs';
import * as formArt from '../../src/capabilities/companion/presentation/form-art.mjs';
import * as art from '../../src/core/pet-art.mjs';
import * as face from '../../src/core/pet-face.mjs';
import * as sceneArt from '../../src/core/pet-scene-art.mjs';
import * as motion from '../../src/core/pet-motion.mjs';
import * as sprite from '../../src/core/pet-sprite.mjs';
import * as expression from '../../src/core/pet-expression.mjs';
import * as appearance from '../../src/core/pet-appearance.mjs';
import * as expressions from '../../src/content/expressions.mjs';
import * as behaviors from '../../src/content/behaviors.mjs';
import * as sessions from '../../src/content/session-activities.mjs';
import * as scenes from '../../src/content/scenes.mjs';
import * as wardrobe from '../../src/content/appearance.mjs';
import * as skins from '../../src/skins.mjs';
export const source = { renderer, compositor, scene, effects, frame, forms, formArt, art, face, sceneArt, motion, sprite, expression, appearance, expressions, behaviors, sessions, scenes, wardrobe, skins };
export async function prepare() { await Promise.all(Object.values(source.forms.PET_FORMS).map(form => source.formArt.prepareArtwork(form, { all: true }))); }

// The existing preview harness resolves session IDs through this diagnostic projection.
// Original catalogs and all production imports remain unchanged.
export const previewSource = { ...source, sessions: { ...sessions, SESSION_ACTIVITIES: Object.freeze({ ...sessions.SESSION_ACTIVITIES, ...sessions.MIRROR_ACTIVITIES }) } };

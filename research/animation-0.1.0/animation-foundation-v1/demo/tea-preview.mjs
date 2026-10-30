import * as T from 'three';
import { createBody, readJSON } from './browser-assets.mjs';
import { createRigidTeaController } from '../../original-parts-hybrid-v1/tea/src/rigid-tea.mjs';
import { normalizeTeaSample } from '../integration/tea-sample-boundary.mjs';
import { createTeaSceneResources, teaLimbOverrides } from '../../original-parts-hybrid-v1/tea/src/scene-resources.mjs';

/** Isolated frozen research choreography. Never registers contact compatibility. */
export async function createTeaPreview(options) {
  const inputs = new URL('../../original-parts-hybrid-v1/tea/inputs/', import.meta.url);
  const [config, hold, sip] = await Promise.all(['rigid-config.json', 'hold-fit.json', 'sip-fit.json'].map(name => readJSON(new URL(name, inputs))));
  const controller = createRigidTeaController({ config, hold, sip });
  const body = await createBody(options);
  const cup = createTeaSceneResources(), scene = new T.Group();
  scene.add(body.f.h.body.root);
  // Cup coordinates belong to the original source skin, not the world stage.
  body.owner.root.add(cup.root);
  let local = 0, cancelAt = null, cancelBase = 0, phase = 'rest';
  return {
    scene, body,
    step(time, dt, reducedMotion) {
      // Input is suppressed in this isolated choreography; FoundationActor has
      // a separate contact gate and is not present in this scene.
      body.f.at(time);
      body.f.h.suspend();
      body.f.tick(time);
      local += dt;
      if (reducedMotion) { local = 0; cancelAt = 0; cancelBase = 0; }
      // Cancellation keeps its cycle epoch: crossing the loop seam must never
      // restart a cup that the user just cancelled.
      const sample = normalizeTeaSample(controller.sample(cancelAt === null ? local % 9 : local - cancelBase,
        { reducedMotion, cancelAt }));
      body.owner.update({ limbMatrices: teaLimbOverrides(sample) });
      cup.apply(sample);
      phase = sample.phase;
      scene.updateMatrixWorld(true);
    },
    cancel() { if (cancelAt !== null) return; cancelAt = local % 9; cancelBase = local - cancelAt; },
    restart() { local = 0; cancelAt = null; cancelBase = 0; },
    snapshot: () => ({ phase, time: local, isolatedResearchReplay: true, wardrobeCompatible: false }),
    dispose() { cup.dispose(); body.dispose(); scene.removeFromParent(); },
  };
}

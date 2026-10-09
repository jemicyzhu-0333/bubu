'use strict';

const projections = new WeakMap();
const cornerProjections = new WeakMap();

function usagiSneezeFaceRig(rig, action, view) {
  if (action?.id !== 'sneeze' || view !== 'profile') return rig;
  if (!projections.has(rig)) {
    const data = rig.views.profile, mouth = {};
    for (const [id, entry] of Object.entries(data.face.mouth)) {
      const shapes = entry.shapes.map((shape, index) => ({ ...shape,
        ...(id === 'wavy' && index === 0 ? { d: 'M-1.6 2.7 Q0 3.3 1.5 2.6' } : {}),
        m: [shape.m[0] / .65 * .78, 0, 0, .76, 57.8, 30.2]
      }));
      mouth[id] = { ...entry, shapes };
    }
    projections.set(rig, { ...rig, views: { ...rig.views,
      profile: { ...data, face: { ...data.face, mouth } } } });
  }
  return projections.get(rig);
}

function usagiProfileFaceRig(rig, action, view) {
  if (action?.id !== 'stuck-corner' || view !== 'profile') return usagiSneezeFaceRig(rig, action, view);
  if (!cornerProjections.has(rig)) {
    const data = rig.views.profile;
    // The worried corner gesture uses the same cramped stacked wavy mouth.
    // Reuse only the already reviewed wavy projection; every other expression
    // and all neutral/profile face landmarks remain the canonical objects.
    const wavy = usagiSneezeFaceRig(rig, { id: 'sneeze' }, 'profile').views.profile.face.mouth.wavy;
    cornerProjections.set(rig, { ...rig, views: { ...rig.views,
      profile: { ...data, face: { ...data.face, mouth: { ...data.face.mouth, wavy } } } } });
  }
  return cornerProjections.get(rig);
}

export { usagiSneezeFaceRig, usagiProfileFaceRig };

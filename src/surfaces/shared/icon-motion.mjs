// Motion follows the object's meaning; all recipes settle at the same baseline.
const RECIPES = {
  bell: [{ rotation: -18 }, { rotation: 14 }, { rotation: -8 }, { rotation: 4 }],
  settings: [{ rotation: 45 }, { rotation: 90 }, { rotation: 90, scale: .88 }],
  capture: [{ scaleX: 1.16, scaleY: .8 }, { scaleX: .95, scaleY: 1.1 }],
  today: [{ scale: .8, rotation: -25 }, { scale: 1.12, rotation: 18 }],
  arrange: [{ x: -3 }, { x: 3 }, { x: -1 }],
  tasks: [{ rotation: -12, scale: .88 }, { rotation: 6, scale: 1.13 }],
  routines: [{ rotation: -12, scale: .92 }, { rotation: 8, scale: 1.08 }],
  inbox: [{ y: -4, scaleY: .85 }, { y: 2, scaleY: 1.1 }],
  archive: [{ scaleY: .55, y: 2 }, { scaleY: 1.08, y: 0 }],
  review: [{ scaleX: .75, rotation: -6 }, { scaleX: 1.04, rotation: 3 }],
  sorting: [{ x: -2, scaleY: .8 }, { x: 2, scaleY: 1.05 }],
  history: [{ rotation: 20 }, { rotation: -6 }],
  companion: [{ rotation: -12, scaleX: .9 }, { rotation: 12, scaleX: 1.1 }, { rotation: -5 }],
  form: [{ scaleX: .65, scaleY: 1.15 }, { scaleX: 1.15, scaleY: .9 }],
  wardrobe: [{ rotation: -16 }, { rotation: 12 }, { rotation: -6 }],
  food: [{ scale: .8 }, { scale: 1.2 }, { scale: .96 }],
  journey: [{ x: 4, rotation: 8 }, { x: -1, rotation: -3 }]
};
function iconMotion(variant, pressed = false) {
  const frames = RECIPES[variant] || [{ scale: .9 }, { scale: 1.08 }];
  return { duration: pressed ? .42 : .55, ease: 'none', keyframes: [
    ...frames.map(frame => ({ ...frame, duration: .1, ease: 'sine.inOut' })),
    { x: 0, y: 0, rotation: 0, scale: 1, scaleX: 1, scaleY: 1, duration: .18, ease: 'power2.out', clearProps: 'transform,opacity,visibility' }
  ] };
}
export { iconMotion };

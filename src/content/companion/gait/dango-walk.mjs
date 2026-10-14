// Source-backed motion content. The original foot is reused, not redrawn per phase.
export const DANGO_SOURCE_WALK = Object.freeze({
 id:'dango-original-foot-walk-v1',runtimeReady:false,host:null,
 view:'three-quarter-right',outfit:'naked',duty:.62,stride:3,lift:12,
 hips:Object.freeze({near:21.5,far:47.5}),groundY:64.5,
 foot:Object.freeze({
  src:'assets/companion/dango/raster/limbs/foot/foot-stand-l-three-quarter-left.png',
  sha256:'ed1dc92bdeb868389b60ca996a48a4cc35cde141b7fc7858eac8e3525d09a73f',
  width:23,height:14,root:Object.freeze([10.5,3.5]),sole:Object.freeze([10.5,10.5]),
  reflectX:true,sourcePose:'approved same-view standing round-arc foot'
 })
});

// Manual workbench-only slice. This does not enter PET_ACTIONS or autonomous
// cue manifests, and never changes the native window or persisted position.
const DANGO_WALK_WORKBENCH = Object.freeze({
 enabled: true,
 action: Object.freeze({
  id: 'ordinary-walk-in-place', name: '原地踏步（团子裸身三分之四）',
  motion: 'idle', prop: 'none', effect: 'none', expression: 'life.idle',
  duration: 7200, staticProgress: 0,
  motionCaps: Object.freeze({ ownsGround: true, stepInPlace: true }),
  previewDefaults: Object.freeze({ skin: 'pink', view: 'three-quarter', level: 1 })
 })
});
export { DANGO_WALK_WORKBENCH };

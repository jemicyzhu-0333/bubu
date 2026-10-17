import fs from 'node:fs/promises';import vm from 'node:vm';import assert from 'node:assert/strict';
const src=(await fs.readFile(new URL('../../src/neutral-demo.mjs',import.meta.url),'utf8')).replace(/^import[\s\S]*?;\s*/gm,'').replaceAll('import.meta.url',JSON.stringify('https://example.test/src/neutral-demo.mjs'));
const results=[];
for(const phase of ['prepare','create'])for(const action of ['dispose','pagehide']) {
 let resolvePack,resolveActor,adds=0,disposed=0,creates=0;const elements=new Map(),handlers={};const element=id=>{if(!elements.has(id))elements.set(id,{clientWidth:100,clientHeight:100,value:'r6',append(){},textContent:''});return elements.get(id)};
 class Scene{add(o){if(o?.actor)adds++}}class Renderer{constructor(){this.domElement={};this.info={render:{calls:0}}}setPixelRatio(){}setClearColor(){}setSize(){}render(){}dispose(){}}
 class Camera{constructor(){this.position={set(){}}}lookAt(){}updateProjectionMatrix(){}}class Light{constructor(){this.position={set(){}}}}
 const actor={root:{actor:true},dispose(){disposed++},verification:{}};
 const context={T:{Scene,WebGLRenderer:Renderer,OrthographicCamera:Camera,HemisphereLight:Light,DirectionalLight:Light},document:{querySelector:element},window:{addEventListener(n,f){handlers[n]=f}},ActorPool:class{create(){creates++;return new Promise(r=>resolveActor=r)}dispose(){}},ContextLifecycle:class{bind(){}dispose(){}},DemandLoop:class{invalidate(){}dispose(){}},ResizeObserver:class{observe(){}disconnect(){}},devicePixelRatio:1,performance:{now:()=>0},URL,requestAnimationFrame(){},cancelAnimationFrame(){},setTimeout,clearTimeout,AbortController,prepareNeutralPack:()=>new Promise(r=>resolvePack=r),browserPackReader:()=>{}};
 vm.runInNewContext(src,context);const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve()};
 if(phase==='create'){resolvePack({});await flush();assert.equal(creates,1)}
 if(action==='dispose')element('#dispose').onclick();else handlers.pagehide();
 if(phase==='prepare')resolvePack({});else resolveActor(actor);await flush();
 assert.equal(adds,0);assert.equal(disposed,phase==='create'?1:0);assert.equal(creates,phase==='create'?1:0);results.push({phase,action,lateActorAdded:adds,discardedActorDisposed:disposed});
}
console.log(JSON.stringify({scope:'VM lifecycle with deferred preparation/creation; no browser/WebGL',results},null,2));

import fs from 'node:fs/promises';
import vm from 'node:vm';
import {ContextLifecycle} from '../../src/context-lifecycle.mjs';
const src=await fs.readFile(new URL('../../src/demo.mjs',import.meta.url),'utf8');
async function runCase(action){
  let resolvePack,adds=0,disposed=0,creates=0;
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{clientWidth:100,clientHeight:100,append(){},textContent:''});return elements.get(id)};
  class Scene{add(o){if(o?.actor)adds++}}
  class Renderer{constructor(){this.domElement=new EventTarget();}setPixelRatio(){}setClearColor(){}setSize(){}render(){}dispose(){}}
  class Camera{constructor(){this.position={set(){}}}lookAt(){}updateProjectionMatrix(){}}
  class Light{constructor(){this.position={set(){}}}}
  const suite={root:{actor:true},dispose(){disposed++},budget:{},timeline:{time:0},face:{path:null,value:0}};
  const document=new EventTarget();document.querySelector=element;document.hidden=false;
  const window=new EventTarget();
  const context={T:{Scene,WebGLRenderer:Renderer,OrthographicCamera:Camera,HemisphereLight:Light,DirectionalLight:Light},document,window,
    ActorPool:class{async create(){creates++;return suite;}dispose(){}get stats(){return {}; }},ContextLifecycle,
    DemandLoop:class{invalidate(){}dispose(){}pause(){}resume(){}},ResizeObserver:class{observe(){}disconnect(){}},devicePixelRatio:1,performance:{now:()=>0},URL,
    requestAnimationFrame(){},cancelAnimationFrame(){},setTimeout,clearTimeout,AbortController,
    preparePack:()=>new Promise(r=>resolvePack=r),browserPackReader:()=>{}};
  vm.runInNewContext(src.replace(/^import[\s\S]*?;\s*/gm,'').replaceAll('import.meta.url',JSON.stringify('https://example.test/src/demo.mjs')),context);
  if(action==='dispose')element('#dispose').onclick();else window.dispatchEvent(new Event('pagehide'));
  resolvePack({});for(let i=0;i<10;i++)await Promise.resolve();
  if(adds!==0||creates!==0)throw Error('Cancelled demo created or attached a late actor');
  return {action,actorsAddedAfterCancellation:adds,poolCreateCalls:creates,disposeCalls:disposed};
}
console.log(JSON.stringify({scope:'Actual demo source in mocked browser lifecycle; real ContextLifecycle EventTargets; no WebGL/GPU',cases:[await runCase('dispose'),await runCase('pagehide')]},null,2));

import {ResourceCache} from './resource-cache.mjs';
import {createSuite} from './suite.mjs';
import {preparedAdmission} from './pack-loader.mjs';
import {exact, fail} from './contracts.mjs';

export const POOL_HARD_LIMITS=Object.freeze({
  actors:32, vertices:1000000, nodes:4096, deformedVertices:4000000, sourceBytes:134217728, clipKeyScalars:500000
});
export const POOL_DEFAULT_LIMITS=Object.freeze({
  actors:8, vertices:200000, nodes:512, deformedVertices:1000000, sourceBytes:33554432, clipKeyScalars:100000
});

/** One application admission/ownership domain. All application actors use this pool.
 * sourceBytes counts unique encoded GLB and clip-library sources, including pending late parses.
 * It is deliberately NOT decoded heap/VRAM or caller-owned prepared-pack memory.
 */
export class ActorPool {
  #cache=new ResourceCache();
  #sources=new Map();
  #actors=new Set();
  #pending=new Set();
  #used={actors:0,vertices:0,nodes:0,deformedVertices:0,sourceBytes:0,clipKeyScalars:0};
  #closed=false;
  #limits;
  constructor(options={}) {
    exact(options,[],['limits'],'ActorPool');
    const limits=options.limits??{};
    exact(limits,[],Object.keys(POOL_HARD_LIMITS),'ActorPool.limits');
    this.#limits=Object.freeze({...POOL_DEFAULT_LIMITS,...limits});
    for(const [key,value] of Object.entries(this.#limits)) {
      if(!Number.isInteger(value)||value<1||value>POOL_HARD_LIMITS[key])fail('LIMIT','Invalid application budget '+key);
    }
  }
  get limits(){return this.#limits;}
  get disposed(){return this.#closed;}
  get stats(){return {...this.#used,active:this.#actors.size,pending:this.#pending.size,cache:{...this.#cache.stats,retainedReferences:this.#cache.retainedReferences}};}

  #prune(key) {
    const source=this.#sources.get(key);
    if(!source||source.refs!==0)return;
    const entry=this.#cache.entries.get(key);
    if(entry) {
      // Aborted GLTF parsing cannot always be cancelled. Keep its reservation
      // until the shared cache has disposed/evicted that late completion.
      if(source.waiting!==entry) {
        source.waiting=entry;
        entry.promise.then(()=>this.#prune(key),()=>this.#prune(key));
      }
      return;
    }
    this.#sources.delete(key);
    this.#used.sourceBytes-=source.bytes;
  }
  #reserve(pack) {
    const cost=preparedAdmission(pack);
    const next={actors:this.#used.actors+1,vertices:this.#used.vertices+cost.vertices,nodes:this.#used.nodes+cost.nodes,deformedVertices:this.#used.deformedVertices+cost.deformedVertices,sourceBytes:this.#used.sourceBytes,clipKeyScalars:this.#used.clipKeyScalars+cost.clipKeyScalars};
    for(const source of cost.sources) {
      const existing=this.#sources.get(source.key);
      if(existing&&existing.bytes!==source.bytes)fail('INTEGRITY','Inconsistent shared source size');
      if(!existing)next.sourceBytes+=source.bytes;
    }
    for(const key of Object.keys(next))if(next[key]>this.#limits[key])fail('GLOBAL_BUDGET','Application '+key+' limit');
    Object.assign(this.#used,next);
    for(const source of cost.sources) {
      let owned=this.#sources.get(source.key);
      if(!owned)this.#sources.set(source.key,owned={bytes:source.bytes,refs:0,waiting:null});
      owned.refs++;
    }
    let released=false;
    return ()=>{
      if(released)return;
      released=true;
      this.#used.actors--;
      for(const key of ['vertices','nodes','deformedVertices','clipKeyScalars'])this.#used[key]-=cost[key];
      for(const source of cost.sources) {
        this.#sources.get(source.key).refs--;
        this.#prune(source.key);
      }
    };
  }
  async create(pack,{signal}={}) {
    if(this.#closed)fail('DISPOSED','ActorPool');
    if(signal?.aborted)throw signal.reason??new Error('Aborted');
    // Atomic reservation precedes any parse/clone promise and cannot be skipped
    // by concurrent callers or by supplying a second cache.
    const release=this.#reserve(pack), abort=new AbortController();
    this.#pending.add(abort);
    const onAbort=()=>abort.abort(signal.reason);
    signal?.addEventListener('abort',onAbort,{once:true});
    let suite=null;
    try {
      suite=await createSuite(pack,this.#cache,{signal:abort.signal});
      if(this.#closed||abort.signal.aborted)throw abort.signal.reason??new Error('Pool disposed');
      const originalDispose=suite.dispose;
      suite.dispose=()=>{
        if(!this.#actors.delete(suite))return;
        try {originalDispose();} finally {release();}
      };
      this.#actors.add(suite);
      return suite;
    } catch(error) {
      try {suite?.dispose();} finally {release();}
      throw error;
    } finally {
      signal?.removeEventListener('abort',onAbort);
      this.#pending.delete(abort);
    }
  }
  dispose() {
    if(this.#closed)return;
    this.#closed=true;
    for(const controller of this.#pending)controller.abort(new Error('ActorPool disposed'));
    for(const suite of [...this.#actors])suite.dispose();
  }
}

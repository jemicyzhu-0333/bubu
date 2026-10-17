/** Synchronous decision-only coordinator. Never claims rendering, loads assets or detects OS activity. */
export class SceneError extends Error {
  constructor(code) { super(code); this.name = 'SceneError'; this.code = code; }
}
const check = (condition, code) => { if (!condition) throw new SceneError(code); };
const copy = x => structuredClone(x);
const id = x => check(typeof x === 'string' && x.length > 0 && x.length <= 256, 'INVALID_ID');
const time = x => check(Number.isSafeInteger(x) && x >= 0, 'INVALID_TIME');
const unique = a => new Set(a).size === a.length;
const pair = (a,b) => [a,b].sort().join('|');
const intersects = (a,b) => a.some(x => b.includes(x));
const MAX_FACTS = 4096;

export function createSceneCoordinator(config, {selectBackground}) {
  const c = copy(config);
  id(c.policyVersion);
  check(typeof selectBackground === 'function', 'BACKGROUND_SELECTOR_REQUIRED');
  check(Number.isSafeInteger(c.maxOverlays) && c.maxOverlays >= 0 && c.maxOverlays <= 16, 'OVERLAY_BOUND');
  check(Array.isArray(c.sources) && c.sources.length <= 64 && unique(c.sources.map(s => s.id)), 'SOURCE_CONFIG');
  const sources = new Map();
  for (const s of c.sources) {
    id(s.id); check(['theme','detection','needs','manual','interaction'].includes(s.kind), 'SOURCE_KIND');
    sources.set(s.id, {kind:s.kind, generation:0, enabled:false, revision:-1, signature:null, facts:[]});
  }
  check(Array.isArray(c.backgrounds) && c.backgrounds.length <= 128 && unique(c.backgrounds.map(x=>x.id)), 'BACKGROUND_CONFIG');
  for (const b of c.backgrounds) { id(b.id); check(typeof b.approved === 'boolean' && typeof b.ready === 'boolean','BACKGROUND_READINESS'); }
  const backgrounds = new Map(c.backgrounds.map(b => [b.id,b]));
  check(Array.isArray(c.recipes) && c.recipes.length <= 128 && unique(c.recipes.map(r=>r.id)), 'RECIPE_CONFIG');
  const recipes = new Map();
  for (const r of c.recipes) {
    id(r.id); check(!r.id.includes('|'), 'RECIPE_ID_SEPARATOR'); id(r.factKey);
    check(['overlay','action','face'].includes(r.kind), 'RECIPE_KIND');
    check(typeof r.approved === 'boolean' && typeof r.ready === 'boolean', 'RECIPE_READINESS');
    check(Array.isArray(r.resources) && unique(r.resources), 'RESOURCES'); r.resources.forEach(id);
    check(!r.resources.includes('environment.base'), 'BASE_RESERVED');
    if (r.kind === 'overlay') {
      check(r.resources.every(x=>x.startsWith('overlay.')), 'OVERLAY_RESOURCE_SCOPE');
      check(Number.isSafeInteger(r.layer), 'OVERLAY_LAYER');
    }
    if (r.kind === 'action') check(r.resources.includes('body.action'), 'MAIN_ACTION_RESOURCE_REQUIRED');
    if (r.kind === 'face') check(r.resources.includes('face.semantic'), 'FACE_RESOURCE_REQUIRED');
    // Only sustained plans are supported. No implicit sparse/replayable one-shot actions.
    check(r.mode === 'sustained', 'UNSUPPORTED_ACTION_MODE');
    recipes.set(r.id,r);
  }
  check(Array.isArray(c.conflicts), 'CONFLICT_POLICY_REQUIRED');
  const rules = new Map();
  for (const rule of c.conflicts) {
    check(Array.isArray(rule.recipes) && rule.recipes.length === 2 && unique(rule.recipes), 'CONFLICT_PAIR');
    const [a,b] = rule.recipes; check(recipes.has(a) && recipes.has(b), 'UNKNOWN_CONFLICT_RECIPE');
    check(!rules.has(pair(a,b)), 'DUPLICATE_CONFLICT');
    check(rule.winner === 'compatible' || rule.recipes.includes(rule.winner), 'CONFLICT_WINNER');
    const ra=recipes.get(a), rb=recipes.get(b);
    check(!(rule.winner === 'compatible' && intersects(ra.resources,rb.resources)), 'SHARED_RESOURCE_COMPATIBILITY');
    rules.set(pair(a,b),rule.winner);
  }
  const rs=[...recipes.values()];
  for (let i=0;i<rs.length;i++) for (let j=i+1;j<rs.length;j++) {
    const a=rs[i],b=rs[j];
    if (intersects(a.resources,b.resources) || (a.kind==='overlay' && b.kind==='overlay'))
      check(rules.has(pair(a.id,b.id)), 'MISSING_CONFLICT_POLICY');
  }
  // Acyclic explicit winners define stable precedence. Lexical order only breaks
  // unrelated ties, never chooses a resource winner. Capacity needs explicit order.
  check(Array.isArray(c.overlayOrder) && unique(c.overlayOrder) && c.overlayOrder.length === rs.filter(r=>r.kind==='overlay').length && c.overlayOrder.every(k=>recipes.get(k)?.kind==='overlay'), 'OVERLAY_CAPACITY_ORDER_REQUIRED');
  const edges = new Map(rs.map(r=>[r.id,[]])); const degree = new Map(rs.map(r=>[r.id,0]));
  for (const rule of c.conflicts) if (rule.winner !== 'compatible') {
    const loser=rule.recipes.find(x=>x!==rule.winner);
    edges.get(rule.winner).push(loser); degree.set(loser,degree.get(loser)+1);
  }
  for (let i=0;i<c.overlayOrder.length;i++) for(let j=i+1;j<c.overlayOrder.length;j++) {
    const a=c.overlayOrder[i], b=c.overlayOrder[j], winner=rules.get(pair(a,b));
    check(winner==='compatible' || winner===a, 'OVERLAY_ORDER_CONFLICT');
    if (winner==='compatible') { edges.get(a).push(b); degree.set(b,degree.get(b)+1); }
  }
  const order=[];
  while (order.length < rs.length) {
    const next=[...degree].filter(([k,d])=>d===0 && !order.includes(k)).map(([k])=>k).sort()[0];
    check(next !== undefined,'CYCLIC_CONFLICT_POLICY'); order.push(next);
    edges.get(next).forEach(k=>degree.set(k,degree.get(k)-1));
  }

  let lastNow=0, session=null, sessionGeneration=0, planGeneration=0, lastPlanSignature=null, validityGeneration=0, lastValiditySignature=null;
  function tick(now) { time(now); check(now>=lastNow,'CLOCK_ROLLBACK'); }
  function source(sourceId) { const s=sources.get(sourceId); check(s,'UNKNOWN_SOURCE'); return s; }
  function snapshotInput(raw,now) {
    const v=copy(raw); id(v.sourceId); const s=source(v.sourceId); time(v.generation); time(v.revision);
    check(Array.isArray(v.facts) && v.facts.length<=MAX_FACTS,'FACT_BOUND');
    check(unique(v.facts.map(f=>f.id)), 'DUPLICATE_FACT');
    for (const f of v.facts) {
      check(typeof f.id==='string' && f.id.length>0 && f.id.length<=2048,'INVALID_FACT_ID'); id(f.key); time(f.observedAt); time(f.expiresAt);
      check(f.observedAt<=now && f.expiresAt>f.observedAt,'FACT_TIME');
    }
    return {v,s};
  }
  const api = {
    startFocus(raw,now) {
      tick(now); check(!session,'FOCUS_ALREADY_STARTED');
      const input=copy(raw); ['sessionId','localDate','timeBand','timeZone'].forEach(k=>id(input[k]));
      check(/^\d{4}-\d{2}-\d{2}$/.test(input.localDate),'LOCAL_DATE');
      new Intl.DateTimeFormat('en',{timeZone:input.timeZone});
      check(Array.isArray(input.candidateIds) && input.candidateIds.length>0 && unique(input.candidateIds),'BACKGROUND_CANDIDATES');
      input.candidateIds.forEach(k=>check(backgrounds.has(k),'UNKNOWN_BACKGROUND'));
      let selectedId=null, blockedReason=null;
      try {
        const selected=selectBackground(copy({...input,selectedAt:now,policyVersion:c.policyVersion}));
        if (selected instanceof Promise) { selected.catch(()=>{}); throw new SceneError('ASYNC_SELECTOR_UNSUPPORTED'); }
        check(input.candidateIds.includes(selected),'INVALID_BACKGROUND_SELECTION');
        const b=backgrounds.get(selected); check(b.approved && b.ready,'BACKGROUND_NOT_READY'); selectedId=selected;
      } catch (e) { blockedReason=e instanceof SceneError ? e.code : 'BACKGROUND_SELECTION_FAILED'; }
      session={...input,selectedAt:now,policyVersion:c.policyVersion,selectedId,blockedReason,selectionToken:++sessionGeneration};
      lastNow=now; return copy(session);
    },
    endFocus(sessionId,selectionToken,now) {
      tick(now); check(session?.sessionId===sessionId && session.selectionToken===selectionToken,'FOCUS_SESSION_MISMATCH'); session=null; lastNow=now;
    },
    setSourceGeneration(sourceId,generation,enabled,now) {
      tick(now); const s=source(sourceId); time(generation); check(typeof enabled==='boolean','ENABLED_BOOLEAN');
      check(generation>s.generation,'GENERATION_MUST_ADVANCE');
      Object.assign(s,{generation,enabled,revision:-1,signature:null,facts:[]}); lastNow=now;
    },
    applySnapshots(rawSnapshots,now) {
      tick(now); check(Array.isArray(rawSnapshots),'SNAPSHOTS_REQUIRED');
      const prepared=rawSnapshots.map(v=>snapshotInput(v,now));
      check(unique(prepared.map(({v})=>v.sourceId)),'DUPLICATE_SOURCE_BATCH');
      const changes=[];
      const statuses=prepared.map(({v,s})=>{
        if (v.generation!==s.generation || !s.enabled) return 'stale_generation';
        if (v.revision<s.revision) return 'stale_revision';
        const signature=JSON.stringify(v.facts.slice().sort((a,b)=>a.id.localeCompare(b.id)));
        if (v.revision===s.revision) { check(signature===s.signature,'REVISION_CONFLICT'); return 'duplicate'; }
        changes.push({s,v,signature}); return 'applied';
      });
      for (const {s,v,signature} of changes) Object.assign(s,{revision:v.revision,signature,facts:v.facts});
      lastNow=now; return statuses;
    },
    plan(now) {
      tick(now); const facts=[], diagnostics=[];
      for (const [sourceId,s] of sources) for (const f of s.facts) {
        const active=s.enabled && now<f.expiresAt;
        facts.push({...f,sourceId,generation:s.generation,factActive:active,status:active?'active':'expired'});
      }
      const activeKeys=new Set(facts.filter(f=>f.factActive).map(f=>f.key));
      const candidates=new Set();
      for (const key of activeKeys) {
        const matching=rs.filter(r=>r.factKey===key);
        if (!matching.length) diagnostics.push({factKey:key,reason:'unknown_mapping'});
        for (const r of matching) {
          if (!r.approved || !r.ready) diagnostics.push({recipeId:r.id,reason:'capability_not_ready'});
          else if (!session?.selectedId) diagnostics.push({recipeId:r.id,reason:'no_ready_focus_session'});
          else candidates.add(r.id);
        }
      }
      const selected=[];
      for (const recipeId of order) if (candidates.has(recipeId)) {
        const r=recipes.get(recipeId);
        const blocker=selected.find(w=>rules.get(pair(w.id,r.id))===w.id);
        if (blocker) diagnostics.push({recipeId,reason:'resource_or_policy_conflict',owner:blocker.id});
        else if (r.kind==='overlay' && selected.filter(x=>x.kind==='overlay').length>=c.maxOverlays) diagnostics.push({recipeId,reason:'overlay_capacity'});
        else selected.push(r);
      }
      const admitted=selected;
      const owners={}; for (const r of admitted) for (const res of r.resources) {
        check(!Object.hasOwn(owners,res),'INTERNAL_RESOURCE_CONFLICT'); owners[res]=r.id;
      }
      const display={base:session?copy(session):null,overlays:admitted.filter(r=>r.kind==='overlay').sort((a,b)=>a.layer-b.layer || a.id.localeCompare(b.id)).map(r=>r.id),mainAction:admitted.find(r=>r.kind==='action')?.id ?? null,face:owners['face.semantic']??null,resourceOwners:owners,selected:admitted.map(r=>r.id).sort()};
      const signature=JSON.stringify(display); if(signature!==lastPlanSignature) { planGeneration++; lastPlanSignature=signature; }
      const validitySignature=JSON.stringify({display,facts:facts.filter(f=>f.factActive),sources:[...sources].map(([k,s])=>[k,s.generation,s.revision,s.enabled])});
      if (validitySignature!==lastValiditySignature) { validityGeneration++; lastValiditySignature=validitySignature; }
      lastNow=now;
      return {validityGeneration,kind:'scene_plan',visible:false,performing:false,planGeneration,policyVersion:c.policyVersion,...display,facts,diagnostics};
    }
  };
  let busy=false;
  return Object.freeze(Object.fromEntries(Object.entries(api).map(([name,fn])=>[name,(...args)=>{
    check(!busy,'REENTRANT_CALL'); busy=true;
    try { return fn(...args); } finally { busy=false; }
  }])));
}

/** Bridge an authoritative ledger.project(now), not business events or OS signals. */
export function themeProjectionSnapshot(projection,{sourceId,generation,revision}) {
  return {sourceId,generation,revision,facts:projection.sources.filter(s=>s.active).map(s=>({id:s.sourceId,key:`theme:${s.themeId}`,observedAt:projection.now,expiresAt:s.expiresAt,ledgerRevision:s.revision,completionGeneration:s.completionGeneration}))};
}

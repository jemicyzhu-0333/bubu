import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLedger,restoreLedger} from '../src/ledger.mjs';
const trace=JSON.parse(readFileSync(new URL('../fixtures/replay-trace.json',import.meta.url),'utf8'));
test('explicit JSON trace replays deadlines, undo, remaining recovery and seal',()=>{
  let l=createLedger(trace.config);
  for(const step of trace.steps){
    if(step.restore) l=restoreLedger(l.snapshot(),step.at);
    l.applyBatch(step.events,step.at);
    if(step.seal) l.seal(step.seal.namespace,step.seal.throughOrdinal,step.seal.checkpointId,step.at);
    const p=l.project(step.at);
    assert.equal(p.themes[0]?.expiresAt ?? null,step.expectedDeadline);
    assert.equal(p.sources.filter(s=>s.active).length,step.expectedActiveSources);
  }
});

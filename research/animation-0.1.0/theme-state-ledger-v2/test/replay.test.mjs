import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLedger,restoreLedger} from '../src/ledger.mjs';
const trace=JSON.parse(readFileSync(new URL('../fixtures/replay-trace.json',import.meta.url),'utf8'));
test('explicit JSON trace replays deadlines, undo, remaining recovery and horizon cleanup',()=>{
  let l=createLedger(trace.config);
  for(const step of trace.steps){
    if(step.restore) l=restoreLedger(l.snapshot('fixture:cursor'),step.at,{sourceCursor:'fixture:cursor',minLastNow:0});
    l.applyBatch(step.events,step.at);
    const p=l.project(step.at);
    assert.equal(p.themes[0]?.expiresAt ?? null,step.expectedDeadline);
    assert.equal(p.sources.filter(s=>s.active).length,step.expectedActiveSources);
  }
});

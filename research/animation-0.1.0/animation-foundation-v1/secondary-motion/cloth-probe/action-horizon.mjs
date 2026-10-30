import assert from 'node:assert/strict';
import {DURATION,sample} from '../../../original-parts-hybrid-v1/tea/src/timeline.mjs';

/** Derive the last required tick from the unchanged action controller. A late
 * cancellation may finish after the nominal nine-second normal action. */
export function clothActionHorizon({cancelAt=null,sampleHz=60}={}) {
  assert([60,120,240].includes(sampleHz));
  assert(cancelAt===null||(Number.isFinite(cancelAt)&&cancelAt>=0&&cancelAt<=DURATION));
  let frames=DURATION*sampleHz;
  const ceiling=(DURATION+2)*sampleHz;
  while(!sample(frames/sampleHz,{cancelAt}).done){
    frames++;assert(frames<=ceiling,'Cancellation tail exceeded the bounded controller contract');
  }
  return {frames,time:frames/sampleHz,nominalDuration:DURATION,sampleHz,cancelAt,
    endpoint:'unchanged controller done=true, never before the full normal horizon'};
}

/** Authored-path variants, not new face geometry or independent face writers.
 * Interactions own these keys; none is added to an autonomous context. */
const candidate=(key,faceId,amount,enterSec=.8,exitSec=.65)=>({key,faceId,amount,selectionWeight:1,enterSec,exitSec,hold:{kind:'fixed',sec:30},gap:{kind:'fixed',sec:.001},cooldownSec:0,sources:['testfixture']});
export const PET_CANDIDATES=Object.freeze([
 candidate('petNotice','08',.55,.35,.5),
 candidate('petRelax','08',1,.75,.7),
 candidate('petEnjoy','P2',1,.9,.65),
 candidate('petQuiet','P2',.82,1.1,.9),
 candidate('petLook','08',1,.55,.65),
 candidate('petRelease','P2',.64,.8,.8),
].map(Object.freeze));

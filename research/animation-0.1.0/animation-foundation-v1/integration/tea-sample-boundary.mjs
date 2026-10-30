/** The frozen quintic timeline can overshoot a unit endpoint by a few ulps.
 * Canonicalize only numerical endpoint noise before strict render admission;
 * substantive out-of-range values remain errors. Never mutate the sample. */
export function normalizeTeaSample(sample) {
  const unit=value=>{
    if(!Number.isFinite(value)||value < -1e-12||value > 1+1e-12)throw RangeError('Tea timeline outside unit range');
    return Math.max(0,Math.min(1,value));
  };
  const normalized=Object.fromEntries(['lift','handEntry','cupScale','cupOpacity'].map(key=>[key,unit(sample?.[key])]));
  const scale=unit(sample?.cup?.scale),opacity=unit(sample?.cup?.opacity);
  if(scale!==normalized.cupScale||opacity!==normalized.cupOpacity)throw Error('Inconsistent tea cup sample');
  if(Object.entries(normalized).every(([key,value])=>value===sample[key])&&scale===sample.cup.scale&&opacity===sample.cup.opacity)return sample;
  return {...sample,...normalized,cup:{...sample.cup,scale,opacity}};
}

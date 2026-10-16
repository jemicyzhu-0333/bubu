import {LIMITS,exact,str,num,list,unique,member,fail} from './contracts.mjs';

export function validateClipLibrary(library,profile,equipment) {
  exact(library,['format','version','id','clips']);
  if(library.format!=='bubu-clips'||library.version!=='0.1.0')fail('VERSION','Only bubu-clips 0.1.0');
  str(library.id);list(library.clips,LIMITS.clips);
  if(!library.clips.length)fail('MISSING','Clip library is empty');
  const targets=new Map(profile.joints.map(j=>['joint:'+j.id,j.capRadians]));
  for(const item of equipment)targets.set('accessory:'+item.id,.5);
  let keys=0;
  for(const clip of library.clips) {
    exact(clip,['id','durationSec','endBehavior','tracks']);str(clip.id);
    num(clip.durationSec,.02,10,'Clip duration');member(clip.endBehavior,['hold'],'Clip end behavior');
    list(clip.tracks,LIMITS.clipTracks);
    if(!clip.tracks.length)fail('MISSING','Clip tracks');
    for(const track of clip.tracks) {
      exact(track,['target','interpolation','keys']);str(track.target);
      if(!targets.has(track.target))fail('REFERENCE','Unknown clip target '+track.target);
      if(track.target.startsWith('joint:')&&!profile.capabilities.includes('skeletal-delta'))fail('UNBOUND_CAPABILITY','skeletal-delta');
      member(track.interpolation,['STEP','LINEAR'],'Clip interpolation');
      list(track.keys,LIMITS.keysPerTrack);
      if(track.keys.length<2)fail('MISSING','At least two clip keys');
      keys+=track.keys.length;
      if(keys>LIMITS.clipKeys)fail('LIMIT','Aggregate clip keys');
      let previous=-Infinity;
      for(const key of track.keys) {
        exact(key,['at','rotation']);num(key.at,0,1,'Key phase');
        // Validator-only roundoff bound; runtime STEP instants are never shifted.
        const gap=(key.at-previous)*clip.durationSec;
        const roundoff=Number.EPSILON*clip.durationSec*(Math.abs(key.at)+Math.abs(previous))*4;
        if(key.at<=previous||gap+roundoff<.0001)fail('KEY_TIME','Keys must increase with at least 0.0001 seconds separation');
        previous=key.at;
        list(key.rotation,4);
        if(key.rotation.length!==4)fail('QUATERNION','Four quaternion components required');
        key.rotation.forEach(v=>num(v,-1.000001,1.000001,'Quaternion component'));
        const norm=Math.hypot(...key.rotation);
        if(Math.abs(norm-1)>1e-6)fail('QUATERNION','Clip key must be unit length within 1e-6');
        const angle=2*Math.acos(Math.min(1,Math.abs(key.rotation[3])/norm));
        if(angle>targets.get(track.target)+1e-6)fail('JOINT_LIMIT',track.target);
      }
      if(track.keys[0].at!==0||track.keys.at(-1).at!==1)fail('KEY_TIME','Exact phase 0 and 1 endpoints required');
    }
    unique(clip.tracks.map(t=>t.target),'Clip track ownership');
  }
  unique(library.clips.map(c=>c.id),'Clip ids');
  return {library,clipKeyScalars:keys*5};
}

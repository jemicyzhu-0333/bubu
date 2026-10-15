import {motionCaps} from './motion-core/action-capabilities.mjs';
const clamp=x=>Math.max(0,Math.min(1,x));
const ease=x=>{const p=clamp(x);return p*p*(3-2*p);};
function sampleFrontStory(action,progress=0,{calmVisual=false,reducedMotion=false}={}) {
 const kind=motionCaps(action).frontStory==='halloween'?'halloween':motionCaps(action).mirrorEvent==='ai'?'ai':null;
 if(!kind)return null;
 const reduced=calmVisual||reducedMotion||action.mirrorPresentation?.static===true;
 const elapsed=reduced?2400:kind==='ai'?(action.mirrorPresentation?.elapsedMs??clamp(progress)*30000):clamp(progress)*7200;
 const exit=kind==='ai'?action.mirrorPresentation?.phase==='exit':elapsed>=6600;
 const opacity=kind==='ai'?clamp(action.propOpacity??1):ease(elapsed/500)*(1-ease((elapsed-6600)/600))*clamp(action.propOpacity??1);
 const phase=exit?'settle':kind==='ai'?elapsed<1400?'listen':(elapsed-1400)%6000<4000?'consider':'acknowledge'
   :elapsed<1400?'prepare':elapsed<3100?'reveal':elapsed<4900?'greet':'return';
 const layers=[];const add=(key,x=0,y=0,alpha=1)=>layers.push(Object.freeze({key,x,y,opacity:alpha*opacity}));
 if(kind==='ai'){
  add('robot-'+phase);
  if(phase==='acknowledge'&&!reduced){const i=Math.round(5-5*Math.sin((elapsed-5400)/2000*Math.PI*2));add('wave-'+String(i).padStart(2,'0'));}
 }else{
  const lift=reduced?0:2.4*ease((elapsed-1400)/900)*(1-ease((elapsed-4900)/1200));
  const paw=[58.6-20.5,39.712821-lift-46],grip=[paw[0]+26.75,paw[1]+45.125];
  const lantern=[grip[0]-14,grip[1]-2.3];
  const ghost=ease((elapsed-1400)/1700)*(1-ease((elapsed-4900)/1700));
  add('ghost',lantern[0]+3.5,lantern[1]+2-ghost*29,ghost);add('pumpkin',...lantern);add('palm',...paw);
 }
 return Object.freeze({kind,phase,elapsed,opacity,reduced,layers:Object.freeze(layers),
   semantic:'authored-companion-story-not-provider-progress'});
}
export const storyResourceKeys=kind=>kind==='halloween'?['ghost','pumpkin','palm']:
 ['robot-listen','robot-consider','robot-acknowledge','robot-settle',...Array.from({length:11},(_,i)=>'wave-'+String(i).padStart(2,'0'))];

export { sampleFrontStory };

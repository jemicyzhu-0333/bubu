export function inputAt(name,t){
 if(name==='slow')return {x:0,y:Math.max(0,Math.min(t-.3,2))*28};
 if(name==='fast'||name==='reverse'||name==='stop'){if(t<1.5)return {x:0,y:Math.max(0,t-.3)*28};const q=t-1.5;if(name==='reverse')return {x:q<.45?q*190:85.5-(q-.45)*190,y:34};if(name==='stop')return {x:Math.min(q,.45)*190,y:34};return {x:q*190,y:34+q*80};}
 if(name==='low')return {x:t*25,y:t<.8?t*40:32-(t-.8)*75};
 if(name==='high')return {x:t*15,y:t*130};
 return {x:0,y:Math.max(0,t-.2)*32};
}
export const cases=[['slow',2.5,4],['fast',2.4,4],['reverse',2.5,4],['stop',2.7,4],['early',.45,2],['low',1.5,3],['high',2,4],['cancel',1,3]];

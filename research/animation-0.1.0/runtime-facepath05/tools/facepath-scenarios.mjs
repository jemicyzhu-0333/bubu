/** Diagnostic temporal cues, not drag/pet interactions or user-facing acting. */
const face=(time,id,amount=1,fadeInSec=.42,fadeOutSec=.28)=>({type:'face',time,id,amount,fadeInSec,fadeOutSec});
const cancel=(time,fadeOutSec=.3)=>({type:'cancel',time,fadeOutSec});
export const FACEPATH_SCENARIOS=Object.freeze({
 semantic_chain:{duration:4.8,events:[face(.2,'04'),face(1.4,'N3'),face(2.9,'A7'),cancel(4.1)]},
 return_current:{duration:2.5,events:[face(.1,'04'),face(.8,'N3'),face(.92,'04'),cancel(1.9)]},
 eye_change:{duration:3.2,events:[face(.2,'07'),face(1.5,'S5'),cancel(2.65)]},
 basis_brow_tongue:{duration:5.8,events:[face(.2,'R0'),cancel(1),face(1.45,'N2'),face(2.75,'N3'),face(4.05,'R0'),cancel(5.15)]},
 interruption:{duration:4.3,events:[face(.1,'04'),face(.32,'N3'),face(.42,'04'),face(.58,'A7'),face(1.35,'07'),face(1.58,'N3'),cancel(1.74),face(2.25,'N3'),face(2.49,'N3',.3),face(2.64,'N2'),cancel(3.5)]}
});

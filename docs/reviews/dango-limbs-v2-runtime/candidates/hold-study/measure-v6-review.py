import json,math
from pathlib import Path
s=69.415385/654;orig=[61,756,1461];bridge=127
# Manually inspected approximate visible palm/prop boundary centers. Not accepted rig anchors.
contact=[[(300,516),(500,516)],[(997,478),(1197,478)],[(1707,445),(1907,445)]]
targets=[[(23.875,53.375),(43.5,53.375)],[(24.5858975,49.889423),(44.2108975,49.889423)],[(25.296795,46.403846),(44.921795,46.403846)]]
out={'status':'diagnostic registration only; approximate source contacts and inferred bridge alignment, not accepted anatomical anchors','commonBodyWidthSource':654,'individualBodyWidths':[651,659,652],'uniformScale':s,'registration':{'canonicalBodyLeft':-1.789744,'canonicalBridgeTop':8.533333,'sourceBridgeTopApprox':127},'panels':[]}
for i in range(3):
 f=lambda p:[-1.789744+(p[0]-orig[i])*s,8.533333+(p[1]-bridge)*s]
 cps=[f(p) for p in contact[i]]
 out['panels'].append({'panel':i+1,'fixedShouldersProjectedIntoSource':[[orig[i]+(x+1.789744)/s,bridge+(45.5-8.533333)/s] for x in [4.5,61.5]],'sourceContactApprox':contact[i],'projectedContacts':cps,'actualSipTargets':targets[i],'shiftPalmToActualTarget':[[round(t[k]-p[k],3) for k in range(2)] for p,t in zip(cps,targets[i])],'notes':'Mid target is arithmetic halfway along actual cup lift, not claimed to be a sampled timeline phase.'})
p=Path('/workspace/shared/bubu-limbs-runtime-v2-meta/hold-production/v6-registration-diagnostic.json');p.write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))

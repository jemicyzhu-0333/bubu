import json, argparse
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,default=Path(__file__).resolve().parent);B=parser.parse_args().out
s=json.loads((B/'sparse.json').read_text());d=json.loads((B/'dense.json').read_text())
r=[r for r in d['rows'] if r['side']=='right']
classes={}
for kind in sorted(set(x['kind'] for x in r)):
 rows=[x for x in r if x['kind']==kind]
 classes[kind]={}
 for version in ['before','after']:
  agg={k:sum(x[version][k] for x in rows) for k in ['samples','visibleSamples','plans','direct','standard','branchChanges','largeElbowJumps','largeWristJumps','exposedTotal','upperExposedTotal']}
  agg.update({k:max((x[version][k] for x in rows if x[version][k] is not None),default=None) for k in ['maxError','maxExposed','maxUpperExposed','maxElbowStep','maxWristStep']})
  classes[kind][version]=agg
tr=lambda rows:{k:sum(x[k]for x in rows) for k in ['admissionLost','admissionGained','standardLost','standardGained','errorIncreased','errorDecreased','exposureIncreased','exposureDecreased']}
rows=[]
for x in r:
 rows.append({k:x[k]for k in ['id','kind','admissionLost','admissionGained','standardLost','standardGained']}|{v:{k:x[v][k]for k in ['samples','direct','standard','maxError','maxExposed','maxUpperExposed','branchChanges','largeElbowJumps','largeWristJumps','maxElbowStep','maxWristStep']}for v in ['before','after']})
result={'oneCandidate':{'assetView':'front','assetSide':'r','from':[61.5,45.5],'to':[58.5,45.5],'basis':'Source body-anchor x58.6 quantized to nearest half-pixel; y remains45.5; no candidate search.'},'sparse':{'actions':s['actionCount'],'allowedViewCombinations':s['combinations'],'phases':s['phases'],'pairedArtworks':s['combinations']*len(s['phases']),'handsPerVariant':sum(x['before']['samples']for x in s['rows']),'transitions':tr(s['rows'])},'dense':{'frontActionCombinations':d['actionCombinations'],'phaseCount':d['phaseCount'],'pairedArtworks':d['actionCombinations']*d['phaseCount'],'handsPerVariant':sum(x['before']['samples']for x in d['rows']),'affectedRightHandsPerVariant':sum(x['before']['samples']for x in r),'transitions':tr(r),'affectedRightClasses':classes,'affectedRightRows':rows},'importantLimits':['Counts are sampled hands, not successful action counts.','All-action standard means actual artist with an explicitly accepted v2 source; production runtimeReady=false and hostAcceptsContract=null.','Hiccup sourceContactPose remains disabled and null. Old and new standard artists both use legacy fallback.','Point-touch is not continuous grip. Integrated and free-aux hands are reported separately.','All diagnostic branch counts include unreachable plans; none are visual pass claims.','Only newly whole-action standard-admitted side is umbrella-dance/front/right; parent reviewed five-phase1x/2x comparison and found no new obvious contour issue. This is limited evidence, not all-action naturalness approval.']}
(B/'aggregate.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'sparse':result['sparse'],'dense':{k:v for k,v in result['dense'].items()if k!='affectedRightRows'}},indent=2))

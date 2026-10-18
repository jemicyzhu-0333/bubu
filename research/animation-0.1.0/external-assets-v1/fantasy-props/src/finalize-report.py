import json,hashlib
from pathlib import Path
r=Path(__file__).resolve().parents[1]
m=json.loads((r/'manifest.json').read_text());audit=json.loads((r/'reports/mount-audit.json').read_text());byid={i['id']:i for i in audit['items']}
for it in m['items']:
 id=it['id'];it['status']={'design':'individual built-in generated concept reviewed; final user review pending','model':'editable real 3D GLB exported','staticMount':'passed' if byid[id]['staticAuditPass'] else 'BLOCKED','animation':'not implemented','wardrobe':'not certified','nativeRuntime':'not tested'}
 it['sha256']=hashlib.sha256((r/it['file']).read_bytes()).hexdigest()
 it['safeBounds']={'local':it['bounds'],'worldStatic':byid[id]['bounds'],'fixedStageLimit':{'x':[-2.63,2.63],'y':[-.40,3.1],'z':[-2.63,2.63]},'scope':'static mount reservation, no motion envelope certification'}
 it['renders']={a:f'renders/{id}-{a}.png' for a in ['front','quarter','side','back']}
 it['mountedRenders']={str(a):f'renders/mounted-{id}-{a}/0000.png' for a in [0,45,90,180]}
 it['mountAudit']=byid[id]
 it['actorInvariant']='All 13 original hybrid body/limb/face meshes: vertex arrays and indices byte-identical. No hand matrix modification, deformation or extra limbs; full original root closure preserved rather than testing one root point.'
 it['classification']='environment' if id=='ground-hole' else 'supporting-creature' if id in ['ghost','butterfly'] else 'effect-geometry' if id=='star' else 'prop'
 if id=='ground-hole':it['environmentContract']={'module':'src/ground-hole-contract.mjs','portable':False,'geometry':'soil cutaway sample with actual oval hole and descending walls','missing':'production renderer ground-mask and actor-fragment clipping integration','camera':'mounted evidence uses elevation 3.3 to expose opening'}
 if id=='knitting-needle':it['mountNote']='Independent left/right group transforms in static fixture; shafts/tips/stops share geometry and material. GLB stores pair side by side for isolated inspection.'
m['status']='Local geometry and static assembly candidates. User final review, wardrobe, action, clipping integration and native runtime acceptance pending.'
m['tests']={'nodeTests':49,'passed':49,'log':'reports/model-tests.log','staticBVH':'reports/mount-audit.json','sourceActor':'../bubu-accessory-expansion-20261018/review/halo-static.json'}
(r/'manifest.json').write_text(json.dumps(m,indent=2))
summary={'count':len(m['items']),'tests':m['tests'],'allStaticPass':all(i['staticAuditPass'] for i in audit['items']),'allBodyAndFaceCrossingsZero':all(i['bodyTriangleCrossings']==i['faceTriangleCrossings']==0 for i in audit['items']),'batches':[['butterfly','ground-hole','bubble-wand'],['magic-hat','star','yarn'],['knitting-needle','pumpkin-lantern','ghost']],'limitations':['No new action timelines','No production integration or OS/GPU claims','Ground-hole is environmental cutaway geometry plus pure clipping contract; runtime material integration pending','No wardrobe combination certification','Generated character reference pixels never replace original actor']}
(r/'reports/summary.json').write_text(json.dumps(summary,indent=2))

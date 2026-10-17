import bpy,json,sys,argparse,math
from pathlib import Path
P=Path(__file__).resolve().parents[1];ap=argparse.ArgumentParser();ap.add_argument('--body',required=True);a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=a.body)
body=bpy.data.objects['A_mochi_skin'];rx=.785-.026;ry=.615-.026;h=.62-.026;base=1.43
head=[v.co for v in body.data.vertices if v.co.z>=base]
levels=[(v.x/rx)**2+(v.y/ry)**2+((v.z-base)/h)**2 for v in head]
inside=sum(x<=1 for x in levels);worst=max(levels)
eyes=[v.co for n in ['A_eye_L','A_eye_R'] for v in bpy.data.objects[n].data.vertices]
minBrimZ=base+.15-.11-.02-.018
report={'headVerticesAboveSeat':len(head),'allHeadVerticesInsideInnerCrown':inside==len(head),'maxInnerEllipsoidLevel':worst,'insideThreshold':1,'seatZ':base,'innerRadii':[rx,ry,h],'minBrimHeightConservative':minBrimZ,'maxBasisEyeHeight':max(v.z for v in eyes),'eyeHeightClearanceConservative':minBrimZ-max(v.z for v in eyes),'scope':'Undeformed approved head versus designed inner ellipsoid; base face eye check only; rigid four-bone motions preserve head fit. Not all18 expressive eye occlusion or pointer-hand test.'}
(P/'review/fit-audit.json').write_text(json.dumps(report,indent=2));print(report)
assert report['allHeadVerticesInsideInnerCrown'];assert report['eyeHeightClearanceConservative']>0

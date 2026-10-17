import bpy,sys,argparse,hashlib,array,json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--candidate-dir',required=True);p.add_argument('--recovered-dir',required=True);p.add_argument('--out',required=True);a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
def digest(path):
 bpy.ops.wm.open_mainfile(filepath=str(path));d={}
 for name in ['A_mochi_skin','A_mouth_ring','A_tongue']:
  o=bpy.data.objects[name];d[name]={x.name:hashlib.sha256(b''.join(array.array('f',c.color).tobytes() for c in x.data)).hexdigest() for x in o.data.color_attributes}
 return d
result={}
for st in ['P2','N3']:
 x=digest(Path(a.candidate_dir)/f'candidate-d-{st}.blend');y=digest(Path(a.recovered_dir)/f'candidate-d-{st}.blend');assert x==y;result[st]={'colorAttributesExact':True,'colorDigests':x}
Path(a.out).write_text(json.dumps(result,indent=2));print('SAVED_CANDIDATE_COLORS_EXACT')

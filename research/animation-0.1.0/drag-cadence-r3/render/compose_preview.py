from PIL import Image,ImageDraw
from pathlib import Path
import json,subprocess,numpy as np
P=Path(__file__).resolve().parents[1];records=json.loads((P/'evidence/trajectory.json').read_text())['records'];out=P/'evidence/annotated';out.mkdir(exist_ok=True)
S=384;scale=S/5
# Exact input function used in replay/generate.mjs, only for visual input annotation.
def pointer(t):
 if t<1.5:x,y=0,max(0,t-.2)*30
 elif t<4.2:x,y=0,39
 elif t<4.5:x,y=(t-4.2)*200,39
 elif t<4.8:x,y=60-(t-4.5)*200,39
 else:x,y=0,39
 return (S/2+x/55.2*scale,S/2-(1.3+y/55.2-1.5)*scale)

for i,r in enumerate(records):
 raw=Image.open(P/f'evidence/continuous-render/{i:04d}.png').convert('RGBA');im=Image.new('RGBA',(S,S),'#eeeae6');im.alpha_composite(raw);d=ImageDraw.Draw(im)
 gy=S/2-(.006-1.5)*scale
 for x in range(0,S,12):d.line((x,gy,x+6,gy),fill='#b4aaa2',width=1)
 t=r['time'];d.text((8,8),f'{t:.2f}s  {r["controller"]["mode"]} / {r["face"]["path"] or "Basis"}',fill='#443c36');d.text((8,S-17),'Actual CPU replay | 30fps | fixed camera',fill='#665b52')
 if t<5.4:
  x,y=pointer(t);d.ellipse((x-3,y-3,x+3,y+3),outline='#087b94',width=1);d.line((x-5,y-5,x-20,y-22),fill='#087b94',width=1);d.text((x-42,y-36),'grip',fill='#087b94')
 im.convert('RGB').save(out/f'{i:04d}.png')
subprocess.run(['ffmpeg','-y','-framerate','30','-i',str(out/'%04d.png'),'-c:v','libx264','-pix_fmt','yuv420p','-crf','18','-movflags','+faststart',str(P/'evidence/drag-r3-slower-cadence.mp4')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
# Diagnostic crops use one fixed crop size/scale; centering is explicitly labelled.
contact=Image.new('RGB',(8*192,2*216),'#eeeae6');d=ImageDraw.Draw(contact)
for row,indices in enumerate([[54,63,72,81,90,99,108,117],[144,146,148,150,152,154,156,158]]):
 for col,i in enumerate(indices):
  im=Image.open(P/f'evidence/continuous-render/{i:04d}.png').convert('RGBA');box=im.getbbox();cx=(box[0]+box[2])/2;cy=(box[1]+box[3])/2;crop=im.crop((int(cx-80),int(cy-80),int(cx+80),int(cy+80))).resize((192,192));contact.paste(crop,(col*192,row*216+24),crop);d.text((col*192+5,row*216+5),f'{"hover" if row==0 else "stop"} {i/30:.3f}s',fill='black')
contact.save(P/'evidence/hover-stop-centered-diagnostic.png')
# Isolate actual limb deformation from whole-character motion in actor-local space.
first=np.fromfile(P/'evidence/continuous-binary/0-A_mochi_skin.bin',dtype='<f4').reshape(-1,3)
def local(v,r):
 m=np.array(r['body']['actorMatrix']).reshape(4,4).T
 return (np.c_[v,np.ones(len(v))]@np.linalg.inv(m).T)[:,:3]
rest=local(first,records[0]);groups={'leftHand':(rest[:,0]<-.92)&(rest[:,1]>.55)&(rest[:,1]<1.0),'rightHand':(rest[:,0]>.92)&(rest[:,1]>.55)&(rest[:,1]<1.0),'leftFoot':(rest[:,0]<-.1)&(rest[:,1]<.15),'rightFoot':(rest[:,0]>.1)&(rest[:,1]<.15)}
tracks={k:[] for k in groups}
for i,r in enumerate(records):
 v=local(np.fromfile(P/f'evidence/continuous-binary/{i}-A_mochi_skin.bin',dtype='<f4').reshape(-1,3),r)
 for k,mask in groups.items():tracks[k].append((v[mask]-rest[mask]).mean(axis=0).tolist())
metrics={k:{'vertices':int(groups[k].sum()),'maxCentroidDisplacementWorld':float(np.linalg.norm(v,axis=1).max()),'maxCentroidDisplacementAt384px':float(np.linalg.norm(v,axis=1).max()*scale),'trajectoryActorLocal':v} for k,v in tracks.items()}
(P/'evidence/limb-relative-motion.json').write_text(json.dumps({'scope':'Actual skin centroid deformation after removing whole actor transform. Diagnostic masks from unchanged source rest geometry. Pixel measure uses 384/5 fixed scale, not exact screen projection.','limbs':metrics},indent=2))
print({k:v['maxCentroidDisplacementAt384px'] for k,v in metrics.items()})

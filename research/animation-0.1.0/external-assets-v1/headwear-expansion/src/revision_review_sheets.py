from PIL import Image,ImageDraw
from pathlib import Path
import json
p=Path(__file__).resolve().parents[1];r=p/'review/revision';d=json.loads((p/'.validation/headwear-expansion/review/forest-static.json').read_text());body=next(m for m in d['frames'][0]['meshes'] if m['name']=='Bubu_body');xs=body['positions'][::3];bodyspan=max(xs)-min(xs);size=round(99*2.9/bodyspan)
ks=['forest','sakura','moon','flame','crown','antenna','pumpkin'];out=Image.new('RGB',(size*7,2*(size+24)),'#eeeeee');draw=ImageDraw.Draw(out)
for row,bg in enumerate(['#eeeeee','#20232b']):
 for j,k in enumerate(ks):
  tile=Image.new('RGB',(size,size+24),bg);im=Image.open(r/f'{k}-0/0000.png').resize((size,size),Image.Resampling.LANCZOS);tile.paste(im,(0,24),im);ImageDraw.Draw(tile).text((5,5),k,fill='black' if row==0 else 'white');out.paste(tile,(j*size,row*(size+24)))
out.save(r/'headwear-99-bodywidth-light-dark.png')
out=Image.new('RGB',(256*3,280*3),'#eeeeee');draw=ImageDraw.Draw(out)
for row,k in enumerate(['forest','flame','antenna']):
 for j,i in enumerate([0,3,15]):
  im=Image.open(r/f'{k}-dynamic/{i:04d}.png');out.paste(im,(j*256,row*280+24),im);draw.text((j*256+4,row*280+4),f'{k}: '+['start','loaded / lag','release / settled'][j],fill='black')
out.save(r/'dynamic-start-lag-recovery.png');(p/'reports/display-scale.json').write_text(json.dumps({'bodyWorldXSpan':bodyspan,'renderSpan':2.9,'derivedTilePx':size,'targetBodyWidthPx':99,'scope':'CPU rendered mesh evidence resampled for 99px body width; not native OS CSS/DPR verification'},indent=2))

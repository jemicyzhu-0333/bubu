from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import hashlib,json
P=Path(__file__).resolve().parent
names=['front','profile','rear-quarter','rear','underside'];out=Image.new('RGB',(1280,300),'#eff1f3');d=ImageDraw.Draw(out)
for i,n in enumerate(names):
 im=Image.open(P/'renders'/f'{n}.png').convert('RGBA');im.thumbnail((256,256));out.paste(im,(i*256,25),im);d.text((i*256+12,8),n,fill='#20242a')
d.text((12,282),'Actual D2 + restored round tail | original geometry unchanged | Blender CPU',fill='#30343a');out.save(P/'review-sheet.png')
font=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',22);small=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',16)
cn=Image.new('RGB',(1200,365),'#eff1f3');draw=ImageDraw.Draw(cn)
for i,(name,label) in enumerate([('front','正面'),('profile','侧面'),('rear-quarter','后侧面'),('rear','背面')]):
 im=Image.open(P/'renders'/f'{name}.png').convert('RGBA');im.thumbnail((300,300));cn.paste(im,(i*300,35),im);draw.text((i*300+20,8),label,font=font,fill='#20242a')
draw.text((20,340),'小圆尾巴恢复候选 · 原有身体与五官不变 · 实际 3D 模型渲染',font=small,fill='#30343a');cn.save(P/'小步小圆尾巴-四视图.png')
files=[f for f in P.rglob('*') if f.is_file() and f.name not in ['evidence-hashes.json'] and f.suffix not in ['.log']]
record={'scope':'Artifact hashes bind current builder, adapter, tests, GLB, render recipe and actual rendered evidence. CPU only.','files':[{'path':str(f.relative_to(P)),'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'bytes':f.stat().st_size} for f in sorted(files)]}
(P/'evidence-hashes.json').write_text(json.dumps(record,indent=2))

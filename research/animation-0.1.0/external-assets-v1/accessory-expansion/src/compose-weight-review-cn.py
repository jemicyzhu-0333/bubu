from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
root=Path(__file__).resolve().parents[2]
font='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';f=ImageFont.truetype(font,18);small=ImageFont.truetype(font,15);title=ImageFont.truetype(font,26)
rows=[('鞋子：保留真实脚，鞋口贴合脚踝','accessory-expansion',[('boots-0','正面'),('boots-90','侧面'),('boots-bottom','底面：两只独立鞋底')]),('浅紫披风：窄肩部支撑，柔软下摆','accessory-expansion',[('cape-45','斜面'),('cape-tail-180','背面・含小圆尾巴'),('cape-tail-90','侧面・尾巴藏在衣料后')]),('梅色披风：自然展开，给尾巴留出空间','themed-accessories',[('plum-45','斜面'),('plum-tail-180','背面・含小圆尾巴'),('plum-tail-90','侧面・含小圆尾巴')]),('尾鳍：保留小扇形，仅一侧轻轻露出','themed-accessories',[('fin-0','正面'),('fin-tail-180','背面・尾鳍与小圆尾巴'),('fin-tail-90','侧面・含小圆尾巴')])]
im=Image.new('RGB',(900,1390),(242,242,239));d=ImageDraw.Draw(im);d.text((22,14),'小步 · 穿戴接触与轮廓修正候选',font=title,fill=(33,38,43));d.text((22,52),'当前实际模型渲染｜身体保持原样｜尚未接入正式运行版本',font=small,fill=(83,88,93))
for r,(heading,folder,items) in enumerate(rows):
 y=88+r*318;d.text((22,y),heading,font=f,fill=(33,38,43))
 for c,(name,label) in enumerate(items):
  p=root/folder/'review/weight-v2'/name/'0000.png';img=Image.open(p).convert('RGBA').resize((280,280),Image.Resampling.LANCZOS);im.paste(img,(c*300+10,y+27),img);d.text((c*300+18,y+294),label,font=small,fill=(70,75,80))
d.text((22,1365),'Three.js 实际网格 → Blender CPU；不代表原生桌面或物理引擎验收。',font=small,fill=(96,100,104));out=root/'accessory-expansion/review/weight-v2/geometry-review-cn.png';im.save(out);print(out)

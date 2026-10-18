from pathlib import Path
import json
from PIL import Image,ImageDraw
from portable_paths import P,ASSET
sheet=Image.new('RGB',(2048,1100),(239,237,231));d=ImageDraw.Draw(sheet)
for row,variant in enumerate(['original','revised']):
 for col,angle in enumerate([-90,-45,90,180]):
  f=ASSET/f'review/satchel-side-{variant}-{angle}/0000.png'
  im=Image.open(f).convert('RGBA');sheet.paste(im,(col*512,row*550),im)
  d.text((col*512+12,row*550+518),f'{variant} | yaw {angle} | actual geometry | span 3.0',fill=(35,35,35))
sheet.save(ASSET/'review/satchel-side-before-after.png')
labels=[f"{f['label']} | t={f['time']:.2f}s" for f in json.loads((P/'review/trajectory-keyframes.json').read_text())['frames']]
sheet=Image.new('RGB',(2304,832),(239,237,231));d=ImageDraw.Draw(sheet)
for row,yaw in enumerate([0,45]):
 for col,label in enumerate(labels):
  f=P/f'review/motion-{yaw}/{col:04d}.png'
  im=Image.open(f).convert('RGBA');sheet.paste(im,(col*384,row*416),im)
  d.text((col*384+8,row*416+388),f'{label} | yaw {yaw} | actual CPU',fill=(35,35,35))
sheet.save(ASSET/'review/weight-contact-motion-keyframes.png')

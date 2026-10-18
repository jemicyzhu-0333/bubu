from PIL import Image,ImageDraw
from pathlib import Path
from portable_paths import P;sheet=Image.new('RGB',(1536,1664),(239,237,231));draw=ImageDraw.Draw(sheet)
for y,k in enumerate(['sprout','sunhat','satchel','scarf']):
 for x,a in enumerate([0,45,90,180]):
  im=Image.open(P/f'review/renders/{k}-{a}/0000.png').convert('RGBA');sheet.paste(im,(x*384,y*416),im);draw.text((x*384+12,y*416+387),f'{k} | {a} degrees | actual hybrid CPU',fill=(35,35,35))
sheet.save(P/'review/existing-four-actual-fourviews.png')

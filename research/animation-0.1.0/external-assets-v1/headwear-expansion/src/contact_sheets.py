from PIL import Image,ImageDraw
from pathlib import Path
from portable_paths import P;p=P/'review';ks=['forest','sakura','moon','flame','crown','antenna','pumpkin']
allviews=Image.new('RGB',(1280,340*7),'#eeeeee')
for row,k in enumerate(ks):
 out=Image.new('RGB',(1280,340),'#eeeeee');d=ImageDraw.Draw(out)
 for i,a in enumerate([0,45,90,180]):
  im=Image.open(p/f'{k}-{a}/0000.png');out.paste(im,(320*i,20),im);d.text((320*i+10,4),k+' / '+str(a)+' degrees',fill='black')
 out.save(p/f'{k}-actual-fourviews.png');allviews.paste(out,(0,row*340))
allviews.save(p/'seven-headwear-actual-contact-sheet.png')

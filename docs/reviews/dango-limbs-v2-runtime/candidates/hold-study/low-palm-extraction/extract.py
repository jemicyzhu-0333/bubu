from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageChops
import hashlib,json
O=Path(__file__).resolve().parent;S=O.parent/'masters/hold-handle-continuous-v6.png';im=Image.open(S).convert('RGBA');sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(S)=='cfcb991f89a0948667949b9004301534daeb120bff0d994a9aef2d455c3bdf3a', 'source master changed'
# Geometric scanline contours manually transcribed from inspected source. No color tests in extraction.
def expand(bands):
 return {y:(a,b) for ya,yb,a,b in bands for y in range(ya,yb+1)}
left=expand([(471,472,245,281),(473,474,240,281),(475,479,239,281),(480,481,230,284),(482,484,229,289),(485,485,224,289),(486,489,223,291),(490,494,223,298),(495,497,225,299),(498,500,225,305),(501,503,225,306),(504,532,226,306),(533,535,227,306),(536,537,227,305),(538,539,228,305),(540,541,228,304),(542,545,229,298),(546,547,229,297),(548,549,230,295),(550,552,230,292),(553,554,231,287),(555,557,231,282),(558,560,232,278),(561,563,232,276),(564,565,233,279),(566,567,234,277),(568,572,234,272),(573,574,236,269)])
# Right cup/handle shaft owns its vertical shared ink. The palm starts at x499 beside it.
right=expand([(477,478,523,548),(479,480,520,551),(481,482,519,558),(483,485,519,559),(486,487,518,560),(488,489,518,563),(490,493,514,566),(494,498,513,566),(499,501,506,566),(502,505,504,566),(506,532,499,567),(533,535,503,567),(536,539,504,567),(540,543,505,567),(544,545,506,567),(546,549,512,567),(550,553,515,566),(554,555,518,566),(556,557,523,566),(558,560,526,566),(561,563,528,566),(564,565,513,565),(566,567,516,565),(568,572,521,565),(573,574,525,565)])
# Final reviewed geometric boundary corrections, transcribed from source rows.
for ya,yb,a in [(471,471,270),(472,472,245),(473,473,244),(474,474,241),(475,478,240),(479,479,239),(480,480,234),(481,481,231),(482,484,230),(485,485,226),(486,492,224),(493,493,223),(494,495,224)]:
 for y in range(ya,yb+1): left[y]=(a,left[y][1])
for ya,yb,b in [(471,480,281),(481,481,287),(482,485,288),(486,486,289),(487,489,291),(490,495,297),(496,496,298),(497,497,301),(498,499,303),(500,500,304),(501,537,305),(538,538,304),(539,540,303),(541,541,302),(542,546,297),(547,548,296),(549,549,292),(550,555,291),(556,556,293),(557,557,292),(558,558,290),(559,559,288),(560,560,286),(561,561,284),(562,562,282),(563,563,280),(564,565,279),(566,566,278),(567,572,271),(573,573,269),(574,574,266)]:
 for y in range(ya,yb+1): left[y]=(left[y][0],b)
for ya,yb,a in [(540,541,497),(542,543,496),(544,545,498),(546,547,499),(548,555,503),(556,557,505),(558,559,507),(560,561,509),(562,563,511),(564,565,513),(566,567,515),(568,572,521),(573,574,525)]:
 for y in range(ya,yb+1):right[y]=(a,right[y][1])
for y in range(499,575):right[y]=(right[y][0],566-round((y-499)*14/75))
right[547]=(503,right[547][1])
frames=[]
for name,rows,contact,normal,ownership in [('left',left,[306.0,520.5],[1,0],'Palm owns the observed shared vertical cup-side black contour; canonical cup must not paint a second front line.'),('right',right,[499.0,520.5],[-1,0],'Cup owns shaft ink x489..498 at contact row. Palm has observed source pink from x499; no fabricated behind palm.')]:
 mask=Image.new('L',im.size);md=ImageDraw.Draw(mask)
 for y,(x0,x1) in rows.items():md.line((x0,y,x1,y),fill=255)
 box=mask.getbbox();rgba=im.crop(box);ma=mask.crop(box);rgba.putalpha(ImageChops.multiply(rgba.getchannel('A'),ma));rgba.save(O/f'{name}-source-rgba.png');ma.save(O/f'{name}-geometric-mask.png');s=69.415385/651
 frames.append({'side':name,'cropBox':list(box),'sourceRgba':f'{name}-source-rgba.png','mask':f'{name}-geometric-mask.png','scanlines':[[y,a,b]for y,(a,b)in rows.items()],'contactSource':contact,'contactConvention':'continuous source pixel-edge coordinate in x, sampled row center in y; not an opaque center or shaft axis','contactLocal':[contact[0]-box[0],contact[1]-box[1]],'normal':normal,'ownership':ownership,'uniformScale':s,'opaqueBoundsSourcePx':[box[2]-box[0],box[3]-box[1]],'opaqueBoundsArt':[(box[2]-box[0])*s,(box[3]-box[1])*s],'originalHoldBoundsArt':[13,13],'rootPolicy':'Open geometric proximal cut; original RGB only, no added cap or other pixels.'})
recipe={'schema':'source-palm-geometric-extraction/1','source':'../masters/hold-handle-continuous-v6.png','sourceSha256':sha(S),'sourceSize':list(im.size),'extraction':'Geometric scanline mask only; preserve original RGBA inside; zero alpha outside. No RGB key and no generated pixels. Binary mask is an explicit new cut boundary, not forced opacity.','status':'reviewed-source-mask-only; not canonical composition or runtime acceptance','frames':frames,'rightHandleAxisSource':[493.5,520.5],'rightHandleAxisRole':'reference only; not the observed palm contact'}
(O/'extraction-recipe.json').write_text(json.dumps(recipe,indent=2)+'\n')
# Review sheet preserves full source context, then isolated RGB cutouts on gray.
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18);sheet=Image.new('RGB',(1290,900),'#e9e8e2');d=ImageDraw.Draw(sheet);box=(190,440,620,600);crop=im.crop(box);bg=Image.new('RGBA',crop.size,'#e9e8e2');bg.alpha_composite(crop);sheet.paste(bg.resize((1290,480),Image.Resampling.NEAREST),(0,45));d.text((10,10),'Geometric scanline extraction | original source RGB | no new outline / back palm',font=font,fill='#222')
for frame in frames:
 rgba=Image.open(O/frame['sourceRgba']);idx=0 if frame['side']=='left' else 1;back=Image.new('RGBA',rgba.size,'#41444b');back.alpha_composite(rgba);sheet.paste(back.resize((rgba.width*3,rgba.height*3),Image.Resampling.NEAREST),(idx*645+145,580));d.text((idx*645+20,540),frame['side']+' | isolated 3x | open wrist cut',font=font,fill='#222')
sheet.save(O/'extraction-review.png');print([(f['side'],f['opaqueBoundsArt'])for f in frames])

# Exact mask overlay on the untouched source crop.
overlay=Image.new('RGBA',crop.size)
od=ImageDraw.Draw(overlay)
for f in frames:
 for y,a,b in f['scanlines']:od.line((a-box[0],y-box[1],b-box[0],y-box[1]),fill=(20,220,170,115))
base=Image.new('RGBA',crop.size,'#e9e8e2');base.alpha_composite(crop);base.alpha_composite(overlay)
ov=Image.new('RGB',(1290,570),'#e9e8e2');ov.paste(base.resize((1290,480),Image.Resampling.NEAREST),(0,55));vd=ImageDraw.Draw(ov);vd.text((10,12),'REVIEWED SOURCE MASKS: green pixels retained; wrist cuts stay open. No new contour.',font=font,fill='#222');vd.text((10,540),'Left owns shared vessel contour; right handle shaft remains cup-owned. No hidden/back palm.',font=font,fill='#222');ov.save(O/'mask-overlay-reviewed.png')
checks=[]
for f in frames:
 image=Image.open(O/f['sourceRgba']).convert('RGBA');mask=Image.open(O/f['mask']);original=im.crop(f['cropBox']);retained=0
 for y in range(image.height):
  for x in range(image.width):
   q=image.getpixel((x,y));assert q[:3]==original.getpixel((x,y))[:3]
   assert q[3]==(original.getpixel((x,y))[3] if mask.getpixel((x,y)) else 0)
   if q[3]:retained+=1
 checks.append({'side':f['side'],'retainedPixels':retained,'allRgbIdenticalToMaster':True,'sourceAlphaPreservedInsideMask':True,'maskSha256':sha(O/f['mask']),'rgbaSha256':sha(O/f['sourceRgba'])})
(O/'verification.json').write_text(json.dumps({'sourceSha256':sha(S),'checks':checks},indent=2)+'\n')

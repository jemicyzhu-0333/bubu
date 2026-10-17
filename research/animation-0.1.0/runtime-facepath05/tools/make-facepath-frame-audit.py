"""Contact-sheet every actual30Hz rendered frame, with no interpolated samples."""
import sys,json
from pathlib import Path
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parents[1]
for name in sys.argv[1:]:
 r=json.loads((root/f'evidence/facepath-replays/{name}.json').read_text());out=root/f'evidence/facepath-frame-audit/{name}';out.mkdir(parents=True,exist_ok=True)
 for start in range(0,len(r['frames']),30):
  frames=r['frames'][start:start+30];sheet=Image.new('RGB',(960,28+160*((len(frames)+5)//6)),(239,236,232));d=ImageDraw.Draw(sheet);d.text((8,8),f'{name}: actual runtime 30Hz frames {start}..{start+len(frames)-1}; fixed99px; offline',fill=(40,40,40))
  for n,f in enumerate(frames):
   x=n%6*160;y=n//6*160+28
   im=Image.open(root/f'evidence/facepath-render/{name}/frames/{f["frame"]:06d}.png').convert('RGBA').resize((141,116),Image.Resampling.LANCZOS);sheet.paste(im,(x+9,y+3),im);state=f['state'];d.text((x+4,y+121),f'{f["frame"]:03} t={f["time"]:.3f} {state["path"] or "Basis"}',fill=(40,40,40));d.text((x+4,y+136),f'{state["value"]:.4f} {state["phase"]}',fill=(40,40,40))
  sheet.save(out/f'frames-{start:03}-{start+len(frames)-1:03}.png')

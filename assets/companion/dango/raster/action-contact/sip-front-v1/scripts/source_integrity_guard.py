"""Read-only extraction guard. Python standard library + Pillow only.
Fixed reviewed source coordinates define ownership. Palette is diagnostic only.
Run without arguments for old-v2 negative and v2b positive plus mutation tests.
"""
from pathlib import Path
from PIL import Image, ImageFilter
import argparse, hashlib, json
R = Path(__file__).resolve().parents[1]
O = Path.cwd()
PAL = ((248,104,120),(248,128,128),(240,80,104),(26,27,38))
# Individually reviewed authored antialias transition, not a blanket color exception.
REVIEWED_EDGE_TRANSITIONS = {'left': {(442,738): (139,48,72,253)}, 'right': {}}
SOURCE_SHA = 'bce60ee4e11ea4740f2243d62a45899bf004c28c436b03348772a4b57f1ac6ee'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def ink(p):
    return p[3] >= 240 and min(range(4), key=lambda i: sum((p[k]-PAL[i][k])**2 for k in range(3))) == 3
def components(cells):
    todo=set(cells); result=[]
    while todo:
        q=[todo.pop()]; part=[]
        while q:
            x,y=q.pop(); part.append((x,y))
            for dx in (-1,0,1):
                for dy in (-1,0,1):
                    p=(x+dx,y+dy)
                    if p in todo: todo.remove(p); q.append(p)
        result.append(part)
    return sorted(result,key=len,reverse=True)
def read(version,side):
    if version == 'v2':
        root=R/'validation/fixtures/v2'
        f=next(f for f in json.loads((root/'crop-metadata.json').read_text())['frames'] if f['side']==side)
        mask=Image.open(root/(side+'-geometric-mask.png')).convert('L')
        crop=Image.open(R/'sources/masters/low-cup-continuous-v2.png').convert('RGBA').crop(f['cropBox'])
        alpha=Image.new('L',crop.size);alpha.putdata([a*m//255 for a,m in zip(crop.getchannel('A').getdata(),mask.getdata())]);crop.putalpha(alpha)
        return f,crop,mask
    root=R/'sources/extraction'
    f=next(f for f in json.loads((root/'extraction-recipe.json').read_text())['frames'] if f['side']==side)
    return f,Image.open(root/f['sourceRgba']).convert('RGBA'),Image.open(root/(side+'-geometric-mask.png')).convert('L')
def audit(version,mutation=None):
    source=R/'sources/masters/low-cup-continuous-v2.png'; src=Image.open(source).convert('RGBA')
    proposal=json.loads((R/'sources/provenance/source-boundary-proposal.original.json').read_text())
    errors=[]; result={}
    if sha(source)!=SOURCE_SHA: errors.append('source identity changed')
    for side in ('left','right'):
        f,img,mask=read(version,side); oldf,old,oldmask=read('v2',side)
        if f['cropBox']!=oldf['cropBox']: errors.append(side+': crop changed'); continue
        B=f['cropBox']; w,h=img.size
        original=src.crop(B)
        plan=proposal['sides'][side]
        allowed={(x,row['y']) for row in plan['fixedUpperBoundaryRows'] if row['addInclusiveX'] for x in range(row['addInclusiveX'][0],row['addInclusiveX'][1]+1)}
        expected=oldmask.copy()
        for x,y in allowed: expected.putpixel((x-B[0],y-B[1]),255)
        if mutation and side=='left':
            x,y=plan['requiredKeepAnchors'][0]; q=(x-B[0],y-B[1]); p=img.getpixel(q)
            if mutation=='missing_anchor': mask.putpixel(q,0); img.putpixel(q,(*p[:3],0))
            if mutation=='recolored': img.putpixel(q,((p[0]+1)%256,*p[1:]))
            if mutation=='alpha_damage': img.putpixel(q,(*p[:3],128))
            if mutation=='extra_body':
                q=next((x,y) for y in range(h) for x in range(w) if not expected.getpixel((x,y)) and original.getpixel((x,y))[3]>=240 and not ink(original.getpixel((x,y))))
                mask.putpixel(q,255); img.putpixel(q,original.getpixel(q))
        rgb_errors=[]; alpha_errors=[]; boundary_errors=[]; retained=set(); added=set(); removed=set()
        for y in range(h):
            for x in range(w):
                p=img.getpixel((x,y)); s=original.getpixel((x,y)); m=mask.getpixel((x,y)); om=oldmask.getpixel((x,y)); xy=(x+B[0],y+B[1])
                if p[:3]!=s[:3]: rgb_errors.append(xy)
                if p[3]!=s[3]*m//255: alpha_errors.append(xy)
                if m!=expected.getpixel((x,y)): boundary_errors.append(xy)
                if m and ink(s): retained.add(xy)
                if m and not om: added.add(xy)
                if om and not m: removed.add(xy)
        anchors_missing=[p for p in plan['requiredKeepAnchors'] if img.getpixel((p[0]-B[0],p[1]-B[1]))!=src.getpixel(tuple(p))]
        nonink_added=[p for p in added if not ink(src.getpixel(p))]
        unexplained_added=[p for p in nonink_added if REVIEWED_EDGE_TRANSITIONS[side].get(p)!=src.getpixel(p)]
        parts=components(retained); sizes=list(map(len,parts))
        expected_sizes=plan['proposedSourceInkComponents']
        for name,bad in [('RGB changed',rgb_errors),('alpha not source-times-mask',alpha_errors),('fixed boundary mismatch',boundary_errors),('mustKeep missing',anchors_missing),('unreviewed non-ink additions',unexplained_added),('retained v2 removed',removed)]:
            if bad: errors.append(f'{side}: {name}: {len(bad)}')
        if sizes!=expected_sizes: errors.append(f'{side}: source connectivity {sizes} != {expected_sizes}')
        # Excluded ink within four source pixels of the final geometry; no auto-restoration.
        dil=mask.filter(ImageFilter.MaxFilter(9))
        near={(x+B[0],y+B[1]) for y in range(h) for x in range(w) if dil.getpixel((x,y)) and not mask.getpixel((x,y)) and ink(original.getpixel((x,y)))}
        clusters=[]
        for part in components(near):
            xs=[p[0] for p in part]; ys=[p[1] for p in part]
            clusters.append({'pixels':len(part),'bbox':[min(xs),min(ys),max(xs),max(ys)]})
        result[side]={'addedPixels':len(added),'removedPixels':len(removed),'nonInkAdded':nonink_added,'unreviewedNonInkAdded':unexplained_added,'mustKeepMissing':anchors_missing,'sourceInkComponents':sizes,'rgbErrorCount':len(rgb_errors),'alphaErrorCount':len(alpha_errors),'fixedBoundaryMismatchCount':len(boundary_errors),'omittedInkNearMaskClusters':clusters}
    return {'version':version,'mutation':mutation,'pass':not errors,'errors':errors,'sides':result}
if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--version',choices=('v2','v2b')); parser.add_argument('--report',type=Path); args=parser.parse_args()
    if args.version:
        report=audit(args.version); print(json.dumps(report,indent=2)); raise SystemExit(0 if report['pass'] else 1)
    reports=[audit('v2'),audit('v2b')]+[audit('v2b',m) for m in ('missing_anchor','recolored','alpha_damage','extra_body')]
    tests=[not reports[0]['pass'],reports[1]['pass']]+[not r['pass'] for r in reports[2:]]
    output={'allTestsPass':all(tests),'reports':reports,'scope':'Source integrity only, not runtime/naturalness acceptance'}
    if args.report: args.report.write_text(json.dumps({'allTestsPass':all(tests),'scope':output['scope'],'cases':[{'version':r['version'],'mutation':r['mutation'],'pass':r['pass'],'errors':r['errors']} for r in reports]},indent=2)+'\n')
    print(json.dumps({'allTestsPass':all(tests),'cases':[{'version':r['version'],'mutation':r['mutation'],'pass':r['pass'],'errors':r['errors']} for r in reports]},indent=2))
    raise SystemExit(0 if all(tests) else 1)

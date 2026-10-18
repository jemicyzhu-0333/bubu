exec(open(__file__.replace('probe-plane.py','audit-mounts.py')).read().split('reports=[]')[0])
d=json.load(open(root/'reports/paper-plane-mounted.json'))['frames'][0]['meshes'];hands=next(m for m in d if m['name']=='Bubu_hand-right');props=[geo(m) for m in d if m['name'].startswith('Plane_')];rows=[]
for v in geo(hands)[0]:
 for _,b in props:
  q,_,_,dist=b.find_nearest(v);rows.append((dist,list(v),list(q)))
print(sorted(rows)[:3])

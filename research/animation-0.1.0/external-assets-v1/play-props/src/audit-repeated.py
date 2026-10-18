exec(open(__file__.replace('audit-repeated.py','audit-mounts.py')).read().split('reports=[]')[0])
rows=[]
for id in ['ball','building-block']:
 d=json.load(open(root/'reports'/f'{id}-repeated.json'))['frames'][0]['meshes'];actor={m['name']:m for m in d if m['name'] in original};props=[geo(m)[1] for m in d if m['name'].startswith('Repeated_')];body=geo(actor['Bubu_body'])[1];face=[geo(m)[1] for n,m in actor.items() if n.startswith('A_') and len(set(m['positions']))>3];row={'id':id,'instances':3,'original13MeshesUnchanged':all(m['positions']==original[n]['positions'] and m['indices']==original[n]['indices'] for n,m in actor.items()),'bodyTriangleCrossings':sum(len(body.overlap(b)) for b in props),'faceTriangleCrossings':sum(len(f.overlap(b)) for b in props for f in face)};assert row['bodyTriangleCrossings']==0 and row['faceTriangleCrossings']==0 and row['original13MeshesUnchanged'];rows.append(row)
json.dump(rows,open(root/'reports/repeated-audit.json','w'),indent=2);print(rows)

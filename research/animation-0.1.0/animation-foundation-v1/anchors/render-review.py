import runpy,json,pathlib,numpy as np,matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
r=pathlib.Path(__file__).resolve().parent
ns=runpy.run_path(str(r/'build-definitions.py'));meshes=ns['meshes'];defs=json.loads((r/'definitions.json').read_text())['anchors']
fig,axes=plt.subplots(2,2,figsize=(20,11));fig.patch.set_facecolor('#f4f5f7')
views=[('FRONT (+Z)',0,1,2,1),('REAR (-Z)',0,-1,2,-1),('LEFT (-X)',2,1,0,-1),('RIGHT (+X)',2,-1,0,1)]
for ax,(title,h,sign,depth,depthsign) in zip(axes.flat,views):
 ax.set_facecolor('#f4f5f7')
 points=np.concatenate([a['POSITION'] for a in meshes.values()]);normals=np.concatenate([a['NORMAL'] for a in meshes.values()]);order=np.argsort(points[:,depth]*depthsign);p=points[order];n=normals[order];shade=np.clip(.77+.16*n[:,1]+.06*n[:,depth]*depthsign,.5,.98);ax.scatter(p[:,h]*sign,p[:,1],s=1.5,c=shade,cmap='gray',vmin=0,vmax=1,rasterized=True,linewidths=0)
 plotted=[]
 for i,d in enumerate(defs):
  p=np.array(d['position']);x=p[h]*sign;y=p[1];normal=np.array(d['normal']);hidden=normal[depth]*depthsign<-.1;color='#546ce6' if not hidden else '#be6e85';ax.scatter([x],[y],s=24,facecolor=color if not hidden else 'white',edgecolor=color,zorder=3);plotted.append((x,y,d['id'],color,hidden));
 for side in [-1,1]:
  rows=sorted([v for v in plotted if (v[0]<0)==(side<0)],key=lambda v:v[1]);levels=np.linspace(.02,1.86,len(rows));
  for (x,y,id,color,hidden),ly in zip(rows,levels):ax.annotate(id,xy=(x,y),xytext=(side*1.36,ly),ha='right' if side<0 else 'left',va='center',fontsize=9,color=color,arrowprops=dict(arrowstyle='-',color=color,lw=.65,linestyle='--' if hidden else '-'))
 ax.set_xlim(-2.35,2.35);ax.set_ylim(-.12,2.02);ax.set_aspect('equal');ax.axis('off');ax.set_title(title,fontsize=16,pad=8)
fig.suptitle('D2 / hybrid anatomical anchor registry — 25 mesh-derived surface samples',fontsize=20,y=.97)
fig.text(.5,.035,'Static source geometry-local review. Blue = camera-facing normal; rose / dashed = back-facing. Labels are semantic mount regions, not new bones.\nFrames: +X tangent, +Y bitangent, +Z outward normal. Front = +Z; anatomical L = source −X. Original mesh arrays remain unchanged.',ha='center',fontsize=12)
plt.subplots_adjust(top=.93,bottom=.09,wspace=.04,hspace=.03);fig.savefig(r/'review/four-view-anchors.png',dpi=160)

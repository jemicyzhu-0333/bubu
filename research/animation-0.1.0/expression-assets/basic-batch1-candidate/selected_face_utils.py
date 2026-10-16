import bpy
STATES=['01','04','05','07','08']
KNOTS=[0,.125,.25,.375,.5,.625,.75,.875,1]
def selected_weights(state='01',amount=0):
 assert state in STATES
 a=max(0,min(1,float(amount)));w={f'Face{s}_{k:02}':0. for s in STATES for k in range(1,9)}
 if a>=1:w[f'Face{state}_08']=1.
 elif a>0:
  i=min(7,int(a*8));t=a*8-i
  if i>0:w[f'Face{state}_{i:02}']=1-t
  w[f'Face{state}_{i+1:02}']=t
 return w

def apply_selected(state='01',amount=0):
 w=selected_weights(state,amount)
 for o in bpy.data.objects:
  if o.type!='MESH' or not o.data.shape_keys:continue
  for k in o.data.shape_keys.key_blocks:
   if k.name!='Basis':k.value=w.get(k.name,0)
 bpy.context.view_layer.update();return w

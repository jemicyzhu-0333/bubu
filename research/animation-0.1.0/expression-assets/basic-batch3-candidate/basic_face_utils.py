import bpy,math
STATES=['N3','T05'];KNOTS=[i/8 for i in range(9)]
def basic_weights(state='N3',amount=0):
 assert state in STATES;assert math.isfinite(float(amount));a=max(0,min(1,float(amount)));w={f'Basic{s}_{k:02}':0. for s in STATES for k in range(1,9)}
 if a>=1:w[f'Basic{state}_08']=1.
 elif a>0:
  i=min(7,int(a*8));t=a*8-i
  if i>0:w[f'Basic{state}_{i:02}']=1-t
  w[f'Basic{state}_{i+1:02}']=t
 return w
def apply_basic(state='N3',amount=0):
 w=basic_weights(state,amount)
 for o in bpy.data.objects:
  if o.type=='MESH' and o.data.shape_keys:
   for key in o.data.shape_keys.key_blocks:
    if key.name!='Basis':key.value=w.get(key.name,0)
 bpy.context.view_layer.update();return w

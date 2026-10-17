"""Authoritative static mapping. One semantic state, adjacent authored knots only.
The caller must route semantic changes through complete zero or a separately
reviewed transition. This module does not invent temporal behavior.
"""
import math,numbers
STATES=('R0','D1','A7','D4','01','N2','N3','T05','07','P2','08','A4','04','A8','S2','S3','T5','S5')
ROSTER=('A_eye_L','A_eye_R','A_eye_highlight_L','A_eye_highlight_R','A_mouth_ring','A_brow_L','A_brow_R','A_tongue')
KNOTS=tuple(i/8 for i in range(9))
def names(state):
 if state not in STATES:raise ValueError('Unknown current semantic state; revised05 is T05, not05')
 prefix='Face' if state in ('01','04','07','08') else'Basic'
 return tuple(f'{prefix}{state}_{i:02}' for i in range(1,9))
ALL_TARGETS=tuple(n for st in STATES for n in names(st))
def face_weights(state=None,intensity=0):
 if isinstance(intensity,bool) or not isinstance(intensity,numbers.Real) or not math.isfinite(float(intensity)) or not 0<=intensity<=1:raise ValueError('Intensity must be finite within0..1')
 out=dict.fromkeys(ALL_TARGETS,0.)
 if state is None:
  if intensity!=0:raise ValueError('Basis has intensity0 only')
  return out
 ns=names(state);a=float(intensity)
 if a==1:out[ns[-1]]=1.
 elif a>0:
  k=int(a*8);frac=a*8-k
  if k:out[ns[k-1]]=1-frac
  out[ns[k]]=frac
 return out

def apply_blender(state=None,intensity=0):
 import bpy
 weights=face_weights(state,intensity)
 for name in ROSTER:
  o=bpy.data.objects[name]
  for key in o.data.shape_keys.key_blocks:
   if key.name!='Basis':key.value=weights.get(key.name,0.)
 bpy.context.view_layer.update();return weights

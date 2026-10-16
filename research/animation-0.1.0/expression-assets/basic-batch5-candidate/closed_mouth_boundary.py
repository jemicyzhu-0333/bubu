"""Radial boundary helper for the shared close_then_shape primitive.

The returned boundary point MUST lie on the input angular ray. A tangent/normal
stroke sweep has a different parameterization and is not a valid substitute.
This helper is geometry-only; surface depth and visibility are checked separately.
"""
import math

def rounded_pill_boundary(u,v,half_width=.061,radius=.023,centre_z=.695):
    if not (0 < radius <= half_width):
        raise ValueError('Require 0 < radius <= half_width')
    length=math.hypot(u,v)
    if length <= 0 or not all(math.isfinite(a) for a in [u,v,half_width,radius,centre_z]):
        raise ValueError('Require a finite nonzero ray')
    u,v=u/length,v/length
    core=half_width-radius
    flat=radius/abs(v) if abs(v)>1e-15 else math.inf
    if abs(flat*u)<=core:
        distance=flat
    else:
        distance=abs(u)*core+math.sqrt(max(0,radius*radius-core*core*v*v))
    return distance*u,centre_z+distance*v

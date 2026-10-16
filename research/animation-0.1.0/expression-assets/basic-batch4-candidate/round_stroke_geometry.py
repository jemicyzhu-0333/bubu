"""Map an existing unit-disk topology to a round-capped curved stroke.

This is local geometry, not a raster reference alteration. Tangent/normal sweep
preserves stroke thickness on steep sides. Outer width and Z bounds are explicit.
The caller must sample the curve back onto the locked body surface for depth.
"""
import math

def swept_capsule(u, v, width, radius, zmin, zmax):
    u=max(-1,min(1,u))
    ss=math.sqrt(max(0,1-u*u))
    q=max(-1,min(1,v/ss)) if ss>1e-9 else 0
    L=width-radius
    cz=zmin+radius
    depth=zmax-zmin-2*radius
    x=width*u
    s=max(-L,min(L,x))
    extra=x-s
    slope=2*depth*s/(L*L)
    norm=math.sqrt(1+slope*slope)
    height=math.sqrt(max(0,radius*radius-extra*extra))*q
    return (s+extra/norm-height*slope/norm,
            cz+depth*(s/L)**2+extra*slope/norm+height/norm)

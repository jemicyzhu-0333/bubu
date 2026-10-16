"""Reusable two-stage open-ring -> closed-stroke chart transition.

This primitive returns projected chart coordinates only. The caller must project
onto the approved body and run attachment/orientation checks. A target stroke
must provide an injective filled-disk correspondence: its rr=0 points coincide.
Never pass a hollow final ring to this closed-mouth route.
"""
import math

def close_then_shape(rr,u,v,amount,end_point,pill_boundary,centre_z=.695,inner_radius=.026,outer_radius=.049,closure_time=.5):
    """rr is normalized annular radius; u/v is a unit angular direction.

    Phase1 closes the inner boundary symmetrically while the outer boundary
    becomes a neutral short capsule. Phase2 bends/translates the already closed
    filled stroke into its authored endpoint. A knot at closure_time is required.
    end_point and pill_boundary are evaluated at the same angular correspondence.
    """
    if not all(math.isfinite(x) for x in [rr,u,v,amount,centre_z]):
        raise ValueError('Nonfinite closed-mouth input')
    if not (0<closure_time<1):raise ValueError('Closure time must be interior')
    t=max(0,min(1,float(amount)))
    gx,gz=end_point
    k=min(1,t/closure_time);k=k*k*(3-2*k)
    px,pz=pill_boundary;pr=math.hypot(px,pz-centre_z)
    inner=inner_radius*(1-k);outer=outer_radius*(1-k)+pr*k
    rad=inner+(outer-inner)*rr;nx=rad*u;nz=centre_z+rad*v
    if t>closure_time:
        k=(t-closure_time)/(1-closure_time);k=k*k*(3-2*k)
        nx=nx*(1-k)+gx*k;nz=nz*(1-k)+gz*k
    return nx,nz

"""Bounded three-variable local fit. Infeasibility applies to these supporting
planes only, not to every nonlinear garment fit. Actual surfaces decide success."""
import json,sys,warnings
import numpy as np
from scipy.optimize import linprog,minimize
d=json.load(sys.stdin);a=np.array(d['coefficients']);b=np.array(d['lower']);bounds=d['bounds']
assert 1<=len(bounds)<=6 and a.ndim==2 and a.shape[1]==len(bounds) and a.shape[0]==len(b)
# HiGHS has its own thread pool; BLAS/OMP environment limits do not bound it.
# SciPy forwards this native option even on versions that warn about its name.
with warnings.catch_warnings():
 warnings.filterwarnings('ignore',message='Unrecognized options detected.*threads.*')
 result=linprog(np.zeros(len(bounds)),A_ub=-a,b_ub=-b,bounds=bounds,method='highs',options={'time_limit':20,'threads':1})
if not result.success:
 print(json.dumps({'status':'infeasible-local-planes' if result.status==2 else 'solver-failed','solverStatus':int(result.status),'message':result.message}));sys.exit(0)
near=minimize(lambda x:float(x@x),result.x,jac=lambda x:2*x,bounds=bounds,constraints=[{'type':'ineq','fun':lambda x:a@x-b,'jac':lambda x:a}],method='SLSQP',options={'maxiter':100,'ftol':1e-12})
x=near.x if near.success else result.x
print(json.dumps({'status':'candidate','delta':x.tolist(),'minimumPlaneSlack':float((a@x-b).min()),'nearestConverged':bool(near.success)}))

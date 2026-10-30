"""PSD projected, consistent polar-rotation Hessian for corotated cells."""
import numpy as np
from scipy import sparse


def corotated_system(d,x,free,modulus):
    G=d['deformation'];F=(G@x).reshape(-1,3,3).transpose(0,2,1)
    u,s,vt=np.linalg.svd(F); rotation=u@vt
    if np.any(np.linalg.det(rotation)<0):raise ArithmeticError('Newton material requires positive orientation')
    modes=[];values=[]
    for a in range(3):
        modes.append(np.einsum('ni,nj->nij',u[:,:,a],vt[:,a,:]).reshape(-1,9));values.append(np.ones(len(F)))
    for a,b in [(0,1),(0,2),(1,2)]:
        ab=np.einsum('ni,nj->nij',u[:,:,a],vt[:,b,:]);ba=np.einsum('ni,nj->nij',u[:,:,b],vt[:,a,:])
        modes.extend([(ab+ba).reshape(-1,9)/np.sqrt(2),(ab-ba).reshape(-1,9)/np.sqrt(2)])
        values.extend([np.ones(len(F)),np.maximum(0,1-2/(s[:,a]+s[:,b]))])
    modes=np.stack(modes,axis=1);values=np.stack(values,axis=1)
    local=np.einsum('nki,nk,nkj->nij',modes,values,modes)*(modulus*d['volumes'])[:,None,None]
    rows=np.arange(len(F)*9).reshape(-1,9)
    constitutive=sparse.coo_matrix((local.reshape(-1),(np.repeat(rows,9,axis=1).reshape(-1),np.tile(rows,(1,9)).reshape(-1))),shape=(len(F)*9,len(F)*9)).tocsr()
    # kron coordinates -> cell-major F flattening.
    B=sparse.block_diag([G]*3,format='csr')
    permutation=np.array([k*G.shape[0]+3*t+j for t in range(len(F)) for k in range(3) for j in range(3)])
    index=np.concatenate([free+k*len(x) for k in range(3)])
    B=B[permutation][:,index]
    gradient=B.T@((F-rotation)*(modulus*d['volumes'])[:,None,None]).reshape(-1)
    return (B.T@constitutive@B).tocsc(),gradient

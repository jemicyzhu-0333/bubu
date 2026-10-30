"""Interior cell barrier for a coupled SQP diagnostic; original J>0 gate retained."""
import numpy as np
from scipy import sparse


def cell_barrier(x,rest,cells,volumes,free,modulus,activation=.25):
    p=x[cells]; a,b,c=np.transpose(p[:,1:]-p[:,:1],(1,0,2))
    J=np.einsum('ij,ij->i',a,np.cross(b,c))/(6*volumes)
    if np.any(J<=0):raise ArithmeticError('Nonpositive barrier argument')
    active=np.flatnonzero(J<activation)
    value=np.zeros(len(J)); first=np.zeros(len(J)); second=np.zeros(len(J))
    j=J[active];h=j-activation;log=np.log(j/activation)
    value[active]=-h*h*log
    first[active]=-2*h*log-h*h/j
    second[active]=-2*log-4*h/j+h*h/(j*j)
    gradient=np.stack([np.cross(b,c),np.cross(c,a),np.cross(a,b)],axis=1)/(6*volumes[:,None,None])
    gradient=np.concatenate([-gradient.sum(axis=1)[:,None],gradient],axis=1)
    selected=cells[active]; g=gradient[active]
    rows=np.repeat(np.arange(len(active)),12)
    cols=np.concatenate([selected+axis*len(x) for axis in range(3)],axis=1).reshape(-1)
    vals=np.transpose(g,(0,2,1)).reshape(-1)
    operator=sparse.csr_matrix((vals,(rows,cols)),shape=(len(active),3*len(x)))
    index=np.concatenate([free+axis*len(x) for axis in range(3)])
    operator=operator[:,index]
    weight=modulus*volumes[active]
    # Exact determinant curvature is essential for tangential directions:
    # grad(J) dot dx may vanish while its quadratic term collapses the cell.
    def cross_matrix(v):
        result=np.zeros((len(v),3,3))
        result[:,0,1]=-v[:,2];result[:,0,2]=v[:,1]
        result[:,1,0]=v[:,2];result[:,1,2]=-v[:,0]
        result[:,2,0]=-v[:,1];result[:,2,1]=v[:,0]
        return result
    hj=np.zeros((len(active),4,3,4,3))
    ca,cb,cc=cross_matrix(a[active]),cross_matrix(b[active]),cross_matrix(c[active])
    hj[:,1,:,2,:]=-cc;hj[:,1,:,3,:]=cb
    hj[:,2,:,1,:]=cc;hj[:,2,:,3,:]=-ca
    hj[:,3,:,1,:]=-cb;hj[:,3,:,2,:]=ca
    hj[:,0,:,1:,:]=-hj[:,1:,:,1:,:].sum(axis=1)
    hj[:,1:,:,0,:]=-hj[:,1:,:,1:,:].sum(axis=3)
    hj=hj.reshape(-1,12,12)/(6*volumes[active,None,None])
    local_gradient=gradient[active].reshape(-1,12)
    local=weight[:,None,None]*(second[active,None,None]*local_gradient[:,:,None]*local_gradient[:,None,:]+first[active,None,None]*hj)
    eigen,vectors=np.linalg.eigh((local+local.transpose(0,2,1))*.5)
    local=(vectors*np.maximum(eigen,0)[:,None,:])@vectors.transpose(0,2,1)
    ids=np.array([selected[:,i]+k*len(x) for i in range(4) for k in range(3)]).T
    hessian=sparse.coo_matrix((local.reshape(-1),(np.repeat(ids,12,axis=1).reshape(-1),np.tile(ids,(1,12)).reshape(-1))),shape=(3*len(x),3*len(x))).tocsc()[index][:,index]
    displacement=(x[free]-rest[free]).T.reshape(-1)
    force=hessian@displacement-operator.T@(weight*first[active])
    bound=1e-6-J[active]+operator@displacement
    return float(np.sum(modulus*volumes*value)),hessian,force,operator,bound,tuple(('volume',int(i),0) for i in active)

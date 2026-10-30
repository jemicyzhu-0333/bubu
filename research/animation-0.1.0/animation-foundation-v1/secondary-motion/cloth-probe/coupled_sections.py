"""Consistent section/edge gradients with PSD Newton curvature."""
import numpy as np
from scipy import sparse


def block_operator(operator,free,groups):
    B=sparse.block_diag([operator]*3,format='csr');rows=operator.shape[0]
    permutation=[k*rows+i for start,count in groups for i in range(start,start+count) for k in range(3)]
    index=np.concatenate([free+k*operator.shape[1] for k in range(3)])
    return B[permutation][:,index]


def shape_system(d,x,free,weights):
    Q=d['shape'];q=Q@x;blocks=[];gradients=[]
    for group in d['shape_groups']:
        start,count=group['start'],group['count'];rest=group['rest'];mass=group['masses'];w=weights[start:start+count]
        value=q[start:start+count];cov=rest.T@(mass[:,None]*value)
        u,s,vt=np.linalg.svd(cov)
        if np.linalg.det(u@vt)<0:u[:,-1]*=-1;s[-1]*=-1
        rotation=u@vt;target=rest@rotation
        p=count*3;dcov=np.zeros((p,3,3))
        for i in range(count):
            for k in range(3):dcov[i*3+k,:,k]=rest[i]*mass[i]
        local=u.T@dcov@vt.T
        denom=s[:,None]+s[None,:];np.fill_diagonal(denom,1)
        if np.any(np.abs(denom)<1e-18):raise ArithmeticError('Singular section rotation derivative')
        dr=u@((local-local.transpose(0,2,1))/denom)@vt
        jac=np.einsum('ni,pij->pnj',rest,dr).reshape(p,p).T
        repeated=np.repeat(w,3)
        H=np.diag(repeated)-repeated[:,None]*jac
        H=(H+H.T)*.5;e,v=np.linalg.eigh(H)
        blocks.append((v*np.maximum(e,0))@v.T)
        gradients.append((w[:,None]*(value-target)).reshape(-1))
    B=block_operator(Q,free,[(g['start'],g['count'])for g in d['shape_groups']])
    return (B.T@sparse.block_diag(blocks,format='csc')@B).tocsc(),B.T@np.concatenate(gradients)


def edge_system(d,x,free,weights):
    E=d['physical'];q=E@x;length=np.linalg.norm(q,axis=1);normal=q/length[:,None]
    tangent=np.maximum(0,1-1/length)
    local=weights[:,None,None]*(tangent[:,None,None]*np.eye(3)+(1-tangent[:,None,None])*normal[:,:,None]*normal[:,None,:])
    rows=np.arange(len(q)*3).reshape(-1,3)
    H=sparse.coo_matrix((local.reshape(-1),(np.repeat(rows,3,axis=1).reshape(-1),np.tile(rows,(1,3)).reshape(-1))),shape=(len(q)*3,len(q)*3)).tocsc()
    B=block_operator(E,free,[(0,len(q))])
    gradient=(weights[:,None]*(1-1/length[:,None])*q).reshape(-1)
    return (B.T@H@B).tocsc(),B.T@gradient

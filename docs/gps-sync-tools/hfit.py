import numpy as np, json
def mp(H,p):
    v=H@np.array([p[0],p[1],1.0]); return v[0]/v[2], v[1]/v[2]
def dlt(pts):
    A=[]
    for (x,y),(X,Y) in pts:
        A.append([x,y,1,0,0,0,-X*x,-X*y,-X]); A.append([0,0,0,x,y,1,-Y*x,-Y*y,-Y])
    _,_,Vt=np.linalg.svd(np.array(A,float)); return Vt[-1].reshape(3,3)
def fit(fix, onx, arc, dd, C, init_extra):
    def res(h):
        H=np.append(h,1.0).reshape(3,3); r=[]
        for p,(X,Y) in fix:
            a,b=mp(H,p); r+=[a-X,b-Y]
        for p,X in onx:
            a,b=mp(H,p); r.append(a-X)
        for p in arc:
            a,b=mp(H,p); r.append(np.hypot(a,b-C)-40)
        for p in dd:
            a,b=mp(H,p); r.append(np.hypot(a-20,b-C)-13)
        return np.array(r)
    H0=dlt(fix+init_extra); h=(H0/H0[2,2]).ravel()[:8]
    for it in range(80):
        r=res(h); J=np.zeros((len(r),8))
        for k in range(8):
            d=np.zeros(8); d[k]=1e-6*max(1,abs(h[k])); J[:,k]=(res(h+d)-r)/d[k]
        step=np.linalg.lstsq(J,-r,rcond=None)[0]; h=h+step
        if np.abs(step).max()<1e-10: break
    r=res(h)
    return np.append(h,1.0).reshape(3,3), float(np.sqrt((r**2).mean())), float(np.abs(r).max())
def best_dt(frames_json, t, vid_xy, to_xy, max_pair=12.0):
    """vid_xy: list of (X,Y) true positions. to_xy(u,v)->(X,Y) in the same frame. Returns list of (dt, mean dist, n)."""
    fr=json.load(open(frames_json))["frames"][str(t)]
    out=[]
    V=np.array(vid_xy)
    for dt,pp in sorted(fr.items(), key=lambda kv: float(kv[0])):
        ids=list(pp); G=np.array([to_xy(pp[j][0],pp[j][1]) for j in ids])
        D=np.hypot(V[:,None,0]-G[None,:,0], V[:,None,1]-G[None,:,1])
        r,c=linear_sum_assignment(np.minimum(D,max_pair))
        d=D[r,c]; ok=d<max_pair
        out.append((float(dt), float(d[ok].mean()) if ok.any() else 99, int(ok.sum()), [(ids[cc], round(float(dd),1)) for cc,dd in zip(c,d)]))
    return out

def linear_sum_assignment(cost):
    """Hungarian (rows <= cols). Returns row idx, col idx."""
    cost=np.asarray(cost,float); n,m=cost.shape
    tr=False
    if n>m: cost=cost.T; n,m=m,n; tr=True
    INF=1e18; u=[0]*(n+1); v=[0]*(m+1); p=[0]*(m+1); way=[0]*(m+1)
    for i in range(1,n+1):
        p[0]=i; j0=0; minv=[INF]*(m+1); used=[False]*(m+1)
        while True:
            used[j0]=True; i0=p[j0]; delta=INF; j1=0
            for j in range(1,m+1):
                if not used[j]:
                    cur=cost[i0-1][j-1]-u[i0]-v[j]
                    if cur<minv[j]: minv[j]=cur; way[j]=j0
                    if minv[j]<delta: delta=minv[j]; j1=j
            for j in range(m+1):
                if used[j]: u[p[j]]+=delta; v[j]-=delta
                else: minv[j]-=delta
            j0=j1
            if p[j0]==0: break
        while True:
            j1=way[j0]; p[j0]=p[j1]; j0=j1
            if j0==0: break
    r=[];c=[]
    for j in range(1,m+1):
        if p[j]: r.append(p[j]-1); c.append(j-1)
    r=np.array(r); c=np.array(c)
    if tr: r,c=c,r
    o=np.argsort(r); return r[o],c[o]

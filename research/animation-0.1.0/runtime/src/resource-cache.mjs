/** Shared asynchronous resource ownership. A cancelled waiter releases only its lease. */
export class ResourceCache {
  constructor() {
    this.entries=new Map();
    this.stats= {
      loads:0, hits:0, disposals:0, live:0
    };
  }
  acquire(key, load, {
    signal
  }
  = {
  }) {
    if(signal?.aborted)return Promise.reject(signal.reason??new Error('Aborted'));
    let e=this.entries.get(key);
    if(!e) {
      e= {
        refs:0, value:null, done:false, disposed:false
      };
      this.entries.set(key, e);
      this.stats.loads++;
      e.promise=Promise.resolve().then(load).then(value=> {
        if(!value||typeof value.dispose!=='function')throw new TypeError('Resource must provide dispose()');
        return value;
      }).then(value=> {
        e.value=value;
        e.done=true;
        this.stats.live++;
        this.maybeDispose(key, e);
        return value;
      }, error=> {
        e.done=true;
        e.error=error;
        if(this.entries.get(key)===e)this.entries.delete(key);
        throw error;
      });
    }
    else this.stats.hits++;
    e.refs++;
    let released=false;
    const release=()=> {
      if(released)return;
      released=true;
      e.refs--;
      this.maybeDispose(key, e);
    };
    return new Promise((resolve, reject)=> {
      let settled=false;
      const abort=()=> {
        if(settled)return;
        settled=true;
        release();
        reject(signal.reason??new Error('Aborted'));
      };
      signal?.addEventListener('abort', abort, {
        once:true
      });
      e.promise.then(value=> {
        if(settled)return;
        settled=true;
        signal?.removeEventListener('abort', abort);
        resolve({
          value, release
        });
      }, error=> {
        if(settled)return;
        settled=true;
        signal?.removeEventListener('abort', abort);
        release();
        reject(error);
      });
    });
  }
  maybeDispose(key, e) {
    if(e.refs!==0||!e.done||!e.value||e.disposed)return;
    e.disposed=true;
    try {
      e.value.dispose();
    }
    finally {
      this.stats.disposals++;
      this.stats.live--;
      if(this.entries.get(key)===e)this.entries.delete(key);
    }
  }
  get retainedReferences() {
    let n=0;
    for(const e of this.entries.values())n+=e.refs;
    return n;
  }
}

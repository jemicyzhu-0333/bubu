import {
  factories
} from './prop-models.mjs';
/** Shared immutable geometry/materials; each borrower owns only its transform tree. */
export function createPropPool(){
  const entries=new Map();
  let closed=false;
  return {
    acquire(id){
      if(closed)throw Error('Pool closed');
      if(!Object.hasOwn(factories,id))throw Error('Unknown prop');
      let e=entries.get(id);
      if(!e){
        e={
          resource:factories[id](),refs:0
        };
        entries.set(id,e);
      }e.refs++;
      const root=e.resource.root.clone(true),sockets=Object.fromEntries(Object.entries(e.resource.sockets).map(([k,v])=>[k,v.clone()]));
      let released=false;
      return{
        root,sockets,release(){
          if(released)return;
          released=true;
          root.removeFromParent();
          root.clear();
          e.refs--;
          if(e.refs===0){
            e.resource.dispose();
            entries.delete(id);
          }
        }
      };
    },get liveAssetCount(){
      return entries.size;
    },close(){
      if([...entries.values()].some(e=>e.refs))throw Error('Release live borrowers first');
      closed=true;
    }
  };
}

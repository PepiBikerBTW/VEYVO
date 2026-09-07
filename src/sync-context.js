(function(root){
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function rebaseRuns(remote,sent,current){const result=new Map(remote.map(r=>[r.id,r])),before=new Map(sent.map(r=>[r.id,r])),after=new Map(current.map(r=>[r.id,r]));for(const [id,old] of before){const changed=after.get(id);if(!same(old,changed)){if(changed)result.set(id,changed);else result.delete(id);}}for(const [id,run] of after)if(!before.has(id))result.set(id,run);return [...result.values()];}
 const api={rebaseRuns};if(typeof module!=='undefined')module.exports=api;else root.VeyvoSync=api;
})(globalThis);

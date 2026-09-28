document.querySelector('#exportRuns').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify({runHistory:state.runHistory,milestones:state.milestones,profile:state.profile},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;
  link.download='veyvo-behy.json';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});

(() => {
 const button=document.querySelector('#music-toggle'),volume=document.querySelector('#music-volume'),status=document.querySelector('#music-status');
 const audio=new Audio('assets/village-watercolor-acoustic.mp3');
 audio.id='background-music';audio.hidden=true;audio.loop=true;audio.preload='auto';document.body.append(audio);
 let preferred=.38,desired=true,pending=false,fade=0,generation=0;
 try{const saved=localStorage.getItem('village-music-volume');if(saved!==null&&Number.isFinite(Number(saved)))preferred=Math.max(0,Math.min(1,Number(saved)));}catch{}
 volume.value=Math.round(preferred*100);audio.volume=preferred;
 function render(){button.setAttribute('aria-pressed',String(desired));button.setAttribute('aria-label',desired?'Turn music off':'Turn music on');}
 function ramp(target,stop=false){
  cancelAnimationFrame(fade);const from=audio.volume,start=performance.now();
  function tick(now){const p=Math.min(1,(now-start)/650);audio.volume=from+(target-from)*p*p*(3-2*p);if(p<1)fade=requestAnimationFrame(tick);else if(stop)audio.pause();}
  fade=requestAnimationFrame(tick);
 }
 async function start(){
  if(!desired||pending||document.hidden)return;
  pending=true;const attempt=generation;
  try{
   await audio.play();
   if(!desired||document.hidden||attempt!==generation){audio.pause();return;}
   ramp(preferred);status.textContent='Playing watercolor acoustic Lo-fi.';
  }catch(error){
   if(desired&&attempt===generation)status.textContent=error.name==='NotAllowedError'?'Music is on. Tap anywhere to start listening.':'Music could not load. Turn it off and on to retry.';
  }finally{pending=false;}
 }
 button.addEventListener('click',()=>{
  desired=!desired;generation++;render();
  if(desired)start();else{ramp(0,true);status.textContent='Music is off.';}
 });
 volume.addEventListener('input',()=>{preferred=Number(volume.value)/100;try{localStorage.setItem('village-music-volume',String(preferred));}catch{}if(desired&&!document.hidden)ramp(preferred);});
 // A trusted gesture retries playback when the browser blocks sound on load.
 function unlock(event){if(!event.target.closest('#music-toggle')&&desired&&audio.paused)start();}
 // Touch/pen activation can arrive on release; click also covers browsers
 // that reject playback during the initial pointerdown.
 for(const event of ['pointerdown','pointerup','click','keydown'])document.addEventListener(event,unlock);
 document.addEventListener('visibilitychange',()=>{generation++;if(document.hidden){cancelAnimationFrame(fade);audio.pause();audio.volume=0;}else if(desired)start();});
 render();start();
})();

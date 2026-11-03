const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function setup() {
 const document = new EventTarget();
 const controls = Object.fromEntries(['music-toggle','music-volume','music-status'].map(id => [id, Object.assign(new EventTarget(), {value:38, textContent:'', setAttribute(){}})]));
 let active = false, audio;
 class Audio {
  constructor(){audio=this;this.paused=true;this.volume=.38;this.attempts=0;}
  play(){this.attempts++;if(!active)return Promise.reject(Object.assign(new Error('Gesture required'),{name:'NotAllowedError'}));this.paused=false;return Promise.resolve();}
  pause(){this.paused=true;}
 }
 document.hidden=false;
 document.querySelector = selector => controls[selector.slice(1)];
 document.body={append(){}};
 vm.runInNewContext(readFileSync(require.resolve('../docs/music.js'),'utf8'), {document, Audio, localStorage:{getItem(){return null},setItem(){}},performance:{now:()=>0},requestAnimationFrame:()=>1,cancelAnimationFrame(){}});
 const flush = () => new Promise(resolve=>setImmediate(resolve));
 async function gesture(type, allowed=true, musicButton=false){
  active=allowed;
  const event=new Event(type);
  Object.defineProperty(event,'target',{value:{closest:()=>musicButton}});
  document.dispatchEvent(event);
  await flush();active=false;
 }
 return {audio, controls, gesture, flush, async toggle(){active=true;controls['music-toggle'].dispatchEvent(new Event('click'));await flush();active=false;}};
}

test('first completed touch starts music when touch-down is blocked', async()=>{
 const app=setup();await app.flush();
 await app.gesture('pointerdown',false);
 assert.equal(app.audio.paused,true);
 await app.gesture('pointerup');
 assert.equal(app.audio.paused,false);
});
test('click fallback starts music without opening settings', async()=>{
 const app=setup();await app.flush();await app.gesture('click');
 assert.equal(app.audio.paused,false);
});
test('mouse and keyboard gestures still start music',async()=>{
 for(const event of ['pointerdown','keydown']){const app=setup();await app.flush();await app.gesture(event);assert.equal(app.audio.paused,false);}
});
test('gestures respect music off and skip the music toggle',async()=>{
 const app=setup();await app.flush();
 await app.gesture('click',true,true);assert.equal(app.audio.paused,true);
 await app.toggle();const attempts=app.audio.attempts;
 for(const event of ['pointerdown','pointerup','click','keydown'])await app.gesture(event);
 assert.equal(app.audio.attempts,attempts);
 await app.toggle();assert.equal(app.audio.paused,false);
});

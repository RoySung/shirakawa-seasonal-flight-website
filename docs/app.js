const canvas=document.querySelector('#landscape'),ctx=canvas.getContext('2d',{alpha:false}),scene=document.querySelector('#scene');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const state={playing:!reduced.matches,cloud:true,snow:true,plane:true,speed:1,time:0,season:'spring'};
let zoom=1;
let W=0,H=0,last=0,loaded=false,dirty=true;
const terrain=document.createElement("canvas");terrain.width=1346;terrain.height=854;
const waterMask=document.createElement('canvas'),waterLayer=document.createElement('canvas');
for(const c of [waterMask,waterLayer]){c.width=1346;c.height=854}
const water=waterLayer.getContext('2d');
const riverRows=[];
// Coordinates are measured in the cropped terrain image, shared by map and vehicles.
const roadKnots=[[505, -40], [497, 0], [485, 80], [472, 160], [461, 240], [457, 320], [454, 400], [453, 480], [465, 560], [491, 640], [519, 720], [550, 800], [568, 854], [590, 895]];
const road=[];
for(let i=0;i<roadKnots.length-1;i++){
 const p0=roadKnots[Math.max(0,i-1)],p1=roadKnots[i],p2=roadKnots[i+1],p3=roadKnots[Math.min(roadKnots.length-1,i+2)];
 for(let j=0;j<16;j++){const u=j/16,u2=u*u,u3=u2*u;road.push([0,1].map(k=>.5*((2*p1[k])+(-p0[k]+p2[k])*u+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*u2+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*u3)))}
}
road.push(roadKnots.at(-1));
const roadLengths=road.slice(1).map((p,i)=>Math.hypot(p[0]-road[i][0],p[1]-road[i][1]));
const roadTotal=roadLengths.reduce((a,b)=>a+b,0);
function roadAt(distance){
 if(distance<0||distance>roadTotal)return null;
 let d=distance;
 for(let i=0;i<roadLengths.length;i++){
  if(d<=roadLengths[i]){const a=road[i],b=road[i+1],u=d/roadLengths[i];return{x:a[0]+(b[0]-a[0])*u,y:a[1]+(b[1]-a[1])*u,angle:Math.atan2(b[1]-a[1],b[0]-a[0])}}
  d-=roadLengths[i];
 }
 return null;
}
function carPose(tileY,scale,slot){
 // Each trip starts above the viewport and ends beyond its bottom edge. No wrap or respawn in view.
 const entry=slot===0?76:38,age=(tileY+entry)/10;
 if(age<0)return null;
 const car=roadAt(age*23);if(!car)return null;
 const lane=3,localX=car.x+Math.sin(car.angle)*lane,localY=car.y-Math.cos(car.angle)*lane;
 return{x:localX,y:localY,screenY:tileY+localY*scale,angle:car.angle};
}
function drawCars(tileY,scale){for(let slot=0;slot<2;slot++){
 const car=carPose(tileY,scale,slot);if(!car||car.screenY < -30 || car.screenY > H+30)continue;
 ctx.save();ctx.translate(car.x,car.y);ctx.rotate(car.angle-Math.PI/2);
 ctx.shadowColor='#2e455644';ctx.shadowBlur=3;ctx.shadowOffsetX=2;ctx.shadowOffsetY=3;ctx.fillStyle=slot===0?'#f4eee2':'#45616c';ctx.beginPath();ctx.roundRect(-4.2,-9,8.4,18,2.8);ctx.fill();ctx.shadowColor='transparent';ctx.fillStyle='#7795a5';ctx.fillRect(-3,3,6,4);ctx.fillStyle='#b4c6cc';ctx.fillRect(-3,-6,6,3);ctx.fillStyle='#f6f4db';ctx.fillRect(-3,7,1.7,1);ctx.fillRect(1.3,7,1.7,1);ctx.restore();
}}
// A hand-painted local repair registers on the original terrain; no synthetic road overlay.
const seamRoad=document.createElement('canvas');seamRoad.width=1346;seamRoad.height=448;
function prepareRoadJoin(image,landscape){
 const full=seamRoad.getContext('2d');full.clearRect(0,0,1346,448);
 // Register both banks of the painted road to the base tile, including its tangent.
 // The generated connector's lower road was 16px right and 10px wider.
 const strip=document.createElement('canvas');strip.width=1346;strip.height=448;
 const paint=strip.getContext('2d');paint.drawImage(landscape,0,0,1346,448);
 const centerAt=y=>{const points=[[0,458],[100,498],[200,541],[224,545],[250,543],[300,528],[350,509],[400,491],[447,475]];let i=0;while(i<points.length-2&&points[i+1][0]<y)i++;const a=points[i],b=points[i+1];return a[1]+(b[1]-a[1])*(y-a[0])/(b[0]-a[0])};
 for(let y=0;y<448;y++){
  const u=Math.max(0,(y-224)/223),u2=u*u,u3=u2*u;
  const sourceCenter=centerAt(y);
  const targetCenter=y<=224?sourceCenter:(2*u3-3*u2+1)*545+(-2*u3+3*u2)*459+(u3-u2)*(-29);
  const width=1-.25*(u*u*(3-2*u));
  const src=[0,sourceCenter-160,sourceCenter-20,sourceCenter+20,sourceCenter+160,1346];
  const dst=[0,sourceCenter-160,targetCenter-20*width,targetCenter+20*width,sourceCenter+160,1346];
  for(let i=0;i<src.length-1;i++)full.drawImage(strip,src[i],y,src[i+1]-src[i],1,dst[i],y,dst[i+1]-dst[i],1);
 }

 full.globalCompositeOperation='destination-in';const blend=full.createLinearGradient(0,0,0,448);
 for(const [at,color]of [[0,'transparent'],[.06,'white'],[.94,'white'],[1,'transparent']])blend.addColorStop(at,color);
 full.fillStyle=blend;full.fillRect(0,0,1346,448);full.globalCompositeOperation='source-over';
}
function riverCenter(y){
 const row=Math.max(0,Math.min(853,y)),i=Math.floor(row),u=row-i;
 return riverRows[i].center*(1-u)+riverRows[Math.min(853,i+1)].center*u;
}
function updateWater(t){
 water.clearRect(0,0,1346,854);water.globalCompositeOperation='source-over';
 // Animate independent pigment strokes, never shifted copies of the scenery.
 // This cannot carry bridge, rock or bank pixels downstream as ghost images.
 water.globalAlpha=1;water.filter='blur(.45px)';
 for(let i=0;i<27;i++){
  const y=mod(i*97.43+t*(12.75+i%4*.6),960)-53,len=36+i%5*5;
  const edge=Math.max(0,Math.min(1,y/36,(854-y-len)/36));if(!edge)continue;
  const lane=(mod(i*.618034,1)-.5)*94;
  const x=riverCenter(y)+lane,ex=riverCenter(y+len)+lane;
  const pigment=water.createLinearGradient(x,y,ex,y+len);
  const rgb=i%3===0?'40,113,151':'167,215,229';
  pigment.addColorStop(0,`rgba(${rgb},0)`);
  pigment.addColorStop(.45,`rgba(${rgb},${.29*edge})`);
  pigment.addColorStop(1,`rgba(${rgb},0)`);
  water.strokeStyle=pigment;water.lineWidth=5+i%4*1.2;water.lineCap='round';
  water.beginPath();water.moveTo(x,y);water.bezierCurveTo(x+1,y+len*.3,ex-1,y+len*.7,ex,y+len);water.stroke();
 }
 water.filter='blur(.35px)';
 // Visible tapered currents advance steadily even at phone scale; opacity does not pulse.
 for(let i=0;i<84;i++){
  const y=mod(i*67.381+t*(15.75+(i%5)*.525),894)-20;
  const lane=(mod(i*39.731,1)-.5)*96,len=21+(i%6)*2.8;
  const edge=Math.max(0,Math.min(1,y/35,(854-y-len)/35));
  if(!edge)continue;
  const x=riverCenter(y)+lane,endX=riverCenter(y+len)+lane;
  const wash=water.createLinearGradient(x,y,endX,y+len);
  wash.addColorStop(0,'rgba(201,231,240,0)');
  wash.addColorStop(.4,`rgba(201,231,240,${.62*edge})`);
  wash.addColorStop(1,'rgba(201,231,240,0)');
  water.strokeStyle=wash;water.lineWidth=2.3+(i%3)*.45;water.lineCap='round';
  water.beginPath();water.moveTo(x,y);
  water.bezierCurveTo(x+.7,y+len*.33,endX-.7,y+len*.67,endX,y+len);water.stroke();
 }
 water.filter='none';
 // Clipping keeps snow, rocks, road and bridge perfectly still.
 water.globalCompositeOperation='destination-in';water.drawImage(waterMask,0,0);water.globalCompositeOperation='source-over';
}
function resize(){W=scene.clientWidth;H=scene.clientHeight;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);dirty=true;if(loaded)draw()}
new ResizeObserver(resize).observe(scene);
let seed=89;function rand(){seed=seed*16807%2147483647;return(seed-1)/2147483646}const mod=(n,m)=>(n%m+m)%m;
const flakes=Array.from({length:106},()=>({x:rand(),y:rand(),z:rand(),phase:rand()*6.28}));
const clouds=[{x:.17,y:.21,s:.12,d:.8},{x:.79,y:.65,s:.10,d:1.2},{x:.47,y:1.12,s:.09,d:.6}];
function cloudSprite(){
 const c=document.createElement('canvas');c.width=260;c.height=200;const g=c.getContext('2d');
 // Translucent layered pigment, uneven edges and tiny paper-grain gaps match the painted terrain.
 const lobes=[[75,117,23],[103,108,32],[131,100,34],[160,113,28],[183,121,18],[112,82,24],[148,83,21]];
 g.filter='blur(2px)';
 for(let pass=0;pass<4;pass++){
  g.fillStyle=pass===0?'rgba(166,194,211,.10)':'rgba(254,255,253,.24)';
  for(const [x,y,r]of lobes){g.beginPath();for(let i=0;i<=28;i++){const a=i/28*Math.PI*2,rr=r*(.92+rand()*.13);const px=x+Math.cos(a)*rr,py=y+Math.sin(a)*rr*.72+(pass===0?8:0);i?g.lineTo(px,py):g.moveTo(px,py)}g.closePath();g.fill()}
 }
 g.filter='none';g.globalCompositeOperation='destination-out';
 for(let i=0;i<1400;i++){g.fillStyle=`rgba(0,0,0,${rand()*.15})`;g.fillRect(rand()*260,rand()*200,.5+rand()*1.5,.5+rand()*1.5)}
 return c;
}const sprite=cloudSprite();
const paperPlane=(()=>{
 const c=document.createElement('canvas');c.width=c.height=192;
 const g=c.getContext('2d');g.scale(4,4);g.translate(24,28);
 // Letter-paper glider: long central fold, broad flat wings, no folded wing tips.
 const silhouette=()=>{g.beginPath();g.moveTo(0,-24);g.lineTo(5,-7);g.lineTo(20,8);g.lineTo(20,14);g.lineTo(3,10);g.lineTo(0,18);g.lineTo(-3,10);g.lineTo(-20,14);g.lineTo(-20,8);g.lineTo(-5,-7);g.closePath()};
 silhouette();g.save();g.clip();
 const wash=g.createLinearGradient(-19,-15,20,17);wash.addColorStop(0,'#faf6e9');wash.addColorStop(.5,'#f2f0e5');wash.addColorStop(1,'#d4e2e7');g.fillStyle=wash;g.fillRect(-24,-28,48,48);
 // Faint blue ruling and a muted red margin make the paper feel like a handwritten letter.
 g.strokeStyle='rgba(104,158,190,.25)';g.lineWidth=.32;
 for(let y=-12;y<19;y+=4){g.beginPath();g.moveTo(-23,y);g.lineTo(23,y+2);g.stroke()}
 g.strokeStyle='rgba(186,123,117,.24)';g.beginPath();g.moveTo(-14,-20);g.lineTo(-14,20);g.stroke();
 g.filter='blur(.2px)';g.beginPath();g.moveTo(0,-24);g.lineTo(3,10);g.lineTo(20,14);g.lineTo(20,8);g.lineTo(5,-7);g.closePath();g.fillStyle='rgba(144,177,192,.17)';g.fill();
 g.beginPath();g.moveTo(0,-24);g.lineTo(-3,10);g.lineTo(0,18);g.lineTo(3,10);g.closePath();g.fillStyle='rgba(102,142,162,.29)';g.fill();g.filter='none';
 g.beginPath();g.moveTo(0,-24);g.lineTo(0,18);g.strokeStyle='rgba(253,253,242,.8)';g.lineWidth=.5;g.stroke();
 for(let i=0;i<340;i++){const x=rand()*48-24,y=rand()*48-28;g.fillStyle=i%3?'rgba(255,254,245,.22)':'rgba(99,144,164,.10)';g.fillRect(x,y,.15+rand()*.6,.15+rand()*.45)}
 g.restore();silhouette();g.strokeStyle='rgba(99,135,151,.30)';g.lineWidth=.4;g.lineJoin='round';g.stroke();
 return c;
})();
// A solid cool pigment silhouette stays legible over the snowy terrain.
const paperShadow=(()=>{
 const c=document.createElement('canvas');c.width=c.height=192;
 const g=c.getContext('2d');g.drawImage(paperPlane,0,0);
 g.globalCompositeOperation='source-in';g.fillStyle='#3e596b';g.fillRect(0,0,192,192);
 return c;
})();
let seasonTransition=null,cameraAdvance=0;
const smoothStep=value=>{const u=Math.max(0,Math.min(1,value));return u*u*u*(u*(u*6-15)+10)};
function flightJourney(){
 if(!seasonTransition)return{p:0,lead:0,reveal:1,advance:0};
 const p=seasonTransition.elapsed/seasonTransition.duration;
 // The glider leads first; the camera catches up as the new landscape arrives.
 const lead=smoothStep(p/.30)*(1-smoothStep((p-.36)/.64));
 const reveal=smoothStep((p-.15)/.80);
 return{p,lead,reveal,advance:seasonTransition.distance*reveal};
}
const incomingScene=document.createElement('canvas'),incoming=incomingScene.getContext('2d');
function copyCanvas(source){const c=document.createElement('canvas');c.width=source.width;c.height=source.height;c.getContext('2d').drawImage(source,0,0);return c}
function paintGround(g,land,join,ripples,x,iw,ih,scale,step,travel,first){
 for(let i=first;i<=first+3;i++){const y=i*step-travel;g.drawImage(land,x,y,iw,ih+1)}
 for(let i=first;i<=first+4;i++){const y=i*step-travel;g.drawImage(join,x,y-224*scale,1346*scale,448*scale)}
 for(let i=first;i<=first+3;i++){const y=i*step-travel;g.drawImage(ripples,x,y,iw,ih)}
}
function draw(){ctx.fillStyle='#eff5f6';ctx.fillRect(0,0,W,H);if(!loaded)return;ctx.save();ctx.translate(W/2,H/2);ctx.scale(zoom,zoom);ctx.translate(-W/2,-H/2);const t=state.time;
// A wide field of view and feathered terrain strips keep the flight moving forward.
const sx=95,sy=85,sw=1346,sh=854,scale=Math.max(W/sw,H/sh)*1.015,iw=sw*scale,ih=sh*scale;
const x=(W-iw)/2;
const step=ih*.97,travel=-t*10-cameraAdvance-flightJourney().advance,first=Math.floor(travel/step)-1;
updateWater(t);
if(seasonTransition){
 const tr=seasonTransition,eased=flightJourney().reveal;
 paintGround(ctx,tr.terrain,tr.join,tr.water,x,iw,ih,scale,step,travel,first);
 const dpr=canvas.width/W;
 if(incomingScene.width!==canvas.width||incomingScene.height!==canvas.height){incomingScene.width=canvas.width;incomingScene.height=canvas.height}
 incoming.setTransform(1,0,0,1,0,0);incoming.clearRect(0,0,incomingScene.width,incomingScene.height);
 incoming.setTransform(dpr,0,0,dpr,0,0);incoming.save();incoming.translate(W/2,H/2);incoming.scale(zoom,zoom);incoming.translate(-W/2,-H/2);
 paintGround(incoming,terrain,seamRoad,waterLayer,x,iw,ih,scale,step,travel,first);incoming.restore();
 // The new season enters from the forward horizon and travels toward the viewer.
 const feather=H*.30,edge=-feather+eased*(H+feather*2);
 const mask=incoming.createLinearGradient(0,edge-feather,0,edge+feather);
 // A broad, eased blend lets foliage and fields change gradually across the horizon.
 mask.addColorStop(0,'rgba(255,255,255,1)');mask.addColorStop(.16,'rgba(255,255,255,.97)');
 mask.addColorStop(.33,'rgba(255,255,255,.82)');mask.addColorStop(.5,'rgba(255,255,255,.5)');
 mask.addColorStop(.67,'rgba(255,255,255,.18)');mask.addColorStop(.84,'rgba(255,255,255,.03)');mask.addColorStop(1,'rgba(255,255,255,0)');
 incoming.globalCompositeOperation='destination-in';incoming.fillStyle=mask;incoming.fillRect(0,0,W,H);incoming.globalCompositeOperation='source-over';
 ctx.save();ctx.setTransform(dpr,0,0,dpr,0,0);ctx.drawImage(incomingScene,0,0,W,H);ctx.restore();
}else paintGround(ctx,terrain,seamRoad,waterLayer,x,iw,ih,scale,step,travel,first);
// Paint traffic after every terrain tile so neighboring tiles cannot cover a moving car.
for(let i=first;i<=first+3;i++){const y=i*step-travel;ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);drawCars(y,scale);ctx.restore()}
if(state.cloud){for(const c of clouds){const size=Math.max(W,H)*c.s*1.55;const cx=mod(c.x*(W+size)+t*(1+c.d),W+size)-size*.5;const cy=mod(c.y*(H+size)+t*(12+c.d)+(cameraAdvance+flightJourney().advance)*.16,H+size)-size*.5;ctx.save();ctx.globalAlpha=.025;ctx.filter='brightness(0) blur(7px)';ctx.drawImage(sprite,cx+8,cy+14,size,size*.77);ctx.filter='none';ctx.globalAlpha=.72;ctx.drawImage(sprite,cx,cy,size,size*.77);ctx.restore()}}
// The guide flies forward with the camera, keeping its heading and a steady lead.
if(state.plane){
 // Layered breezes move the whole paper glider; its bank follows the sideways drift.
 const breeze=Math.sin(t*.65),gust=Math.sin(t*1.17+.6);
 const journey=flightJourney();
 const x=W*(.48+.022*breeze+.007*gust-.012*Math.sin(Math.PI*journey.p)),y=H*(.59+.005*Math.sin(t*.82+.4)-.105*journey.lead);
 const bank=(.19*Math.cos(t*.65)+.055*Math.cos(t*1.17+.6))*(1-.75*journey.lead)-.07*Math.sin(Math.PI*journey.p);
 const flightScale=.76*Math.max(.7,Math.min(1.2,W/850)),k=flightScale*.85*(1-.06*journey.lead);
 // Project the shadow farther away in a fixed sunlight direction, independent of banking.
 // A broader, softer ground shadow separates the glider from the terrain below.
 const altitude=1+.045*Math.sin(t*.42),shadowScale=k*.96;
 ctx.save();ctx.translate(x+68*flightScale*altitude,y+104*flightScale*altitude);ctx.rotate(bank);
 ctx.scale(shadowScale*(1-.09*Math.abs(breeze)),shadowScale);
 ctx.filter='blur(3.1px)';ctx.globalAlpha=.32;
 ctx.drawImage(paperShadow,-24,-28,48,48);ctx.restore();
 ctx.save();ctx.translate(x,y);ctx.rotate(bank);ctx.scale(k*(1-.09*Math.abs(breeze)),k);
 ctx.drawImage(paperPlane,-24,-28,48,48);ctx.restore();
}
if(seasonTransition){const p=flightJourney().reveal;drawParticles(seasonTransition.from,1-p);drawParticles(state.season,p)}else drawParticles(state.season,1);
ctx.restore();dirty=false}
function drawParticles(season,alpha){if(alpha<=0)return;const t=state.time;ctx.save();ctx.globalAlpha=alpha;
if(state.snow&&season==='spring'){for(const f of flakes.slice(0,35)){const z=.25+f.z*.75,x=mod(f.x*W+t*(7+z*5)+Math.sin(t*.7+f.phase)*12,W+12)-6,y=mod(f.y*H+t*(7+z*8),H+12)-6;ctx.save();ctx.translate(x,y);ctx.rotate(t*.7+f.phase);ctx.fillStyle=`rgba(245,183,199,${.55+f.z*.3})`;ctx.beginPath();ctx.ellipse(0,0,1.1+f.z*1.1,.5+f.z*.6,0,0,Math.PI*2);ctx.fill();ctx.restore()}}
if(state.snow&&season==='autumn'){for(const f of flakes.slice(0,25)){const z=.25+f.z*.75,x=mod(f.x*W+t*(8+z*6)+Math.sin(t*.6+f.phase)*16,W+20)-10,y=mod(f.y*H+t*(9+z*9),H+20)-10;ctx.save();ctx.translate(x,y);ctx.rotate(t*.65+f.phase);ctx.fillStyle=f.z>.5?'rgba(178,83,43,.75)':'rgba(211,155,62,.8)';ctx.beginPath();ctx.moveTo(0,-2-z);ctx.quadraticCurveTo(3+z,0,0,2+z);ctx.quadraticCurveTo(-2-z,0,0,-2-z);ctx.fill();ctx.restore()}}
if(state.snow&&season==='summer'){for(const f of flakes.slice(0,14)){const x=mod(f.x*W+t*5+Math.sin(t*.5+f.phase)*9,W+10)-5,y=mod(f.y*H+t*3,H+10)-5;ctx.fillStyle='rgba(244,242,211,.6)';ctx.beginPath();ctx.ellipse(x,y,1,.6,t*.4+f.phase,0,Math.PI*2);ctx.fill()}}
if(state.snow&&season==='winter'){for(const f of flakes){const z=.25+f.z*.75,x=mod(f.x*W+t*(4+z*5)+Math.sin(t*.4+f.phase)*5,W+10)-5,y=mod(f.y*H+t*(9+z*14),H+10)-5;ctx.beginPath();ctx.fillStyle=`rgba(255,255,255,${.35+f.z*.4})`;ctx.arc(x,y,.4+f.z*.8,0,Math.PI*2);ctx.fill()}}ctx.restore();}
function animate(now){const frameSeconds=Math.max(0,(now-last)/1000||0),dt=Math.min(frameSeconds,.05);last=now;if(state.playing&&!document.hidden){state.time+=dt*state.speed;dirty=true}if(seasonTransition&&!document.hidden){seasonTransition.elapsed=Math.min(seasonTransition.duration,seasonTransition.elapsed+frameSeconds);dirty=true;if(seasonTransition.elapsed>=seasonTransition.duration){cameraAdvance+=seasonTransition.distance;seasonTransition=null;setSeasonBusy(false);document.querySelector('#season-status').textContent=`Now flying through ${state.season}.`}}if(dirty)draw();requestAnimationFrame(animate)}
function prepareTerrain(img){const g=terrain.getContext("2d");g.globalCompositeOperation="source-over";g.clearRect(0,0,1346,854);g.drawImage(img,95,85,1346,854,0,0,1346,854);// Replace the two photographed cars with road texture before animating their replacements.
const mask=waterMask.getContext('2d');mask.clearRect(0,0,1346,854);mask.drawImage(terrain,0,0);const pixels=mask.getImageData(0,0,1346,854);for(let i=0;i<pixels.data.length;i+=4){const x=(i/4)%1346,r=pixels.data[i],green=pixels.data[i+1],b=pixels.data[i+2];pixels.data[i]=255;pixels.data[i+1]=255;pixels.data[i+2]=255;pixels.data[i+3]=x>800&&x<1135&&r<145&&b>r*1.23&&green>r*1.12?Math.min(255,(145-r)*8):0}mask.putImageData(pixels,0,0);
mask.save();mask.globalCompositeOperation='destination-out';mask.lineCap='round';mask.lineWidth=45;
mask.beginPath();mask.moveTo(815,364);mask.lineTo(1080,430);mask.stroke();mask.restore();

for(let y=0;y<854;y++){let sum=0,count=0;for(let x=800;x<1135;x++){if(pixels.data[(y*1346+x)*4+3]>128){sum+=x;count++}}riverRows[y]=count>3?{center:sum/count}:null}
// Smooth the river course across rocks and the bridge before sampling moving marks.
const rawCenters=riverRows.map(row=>row?.center??960);
for(let y=0;y<854;y++){let sum=0,weight=0;for(let d=-40;d<=40;d++){const w=41-Math.abs(d);sum+=rawCenters[Math.max(0,Math.min(853,y+d))]*w;weight+=w}riverRows[y]={center:sum/weight}}
g.globalCompositeOperation="destination-in";const fade=g.createLinearGradient(0,0,0,854);fade.addColorStop(0,"transparent");fade.addColorStop(.03,"white");fade.addColorStop(.97,"white");fade.addColorStop(1,"transparent");g.fillStyle=fade;g.fillRect(0,0,1346,854);}
const seasons={
 summer:{seam:'assets/flat-join-summer.png',base:'assets/flat-summer.png',caption:'Summer · Green fields below',particles:'Summer breeze'},
 autumn:{seam:'assets/flat-join-autumn.png',base:'assets/flat-autumn.png',caption:'Autumn · A village in golden leaves',particles:'Falling leaves'},
 spring:{seam:'assets/flat-join-spring.png',base:'assets/flat-spring.png',caption:'Spring · Cherry blossoms over the village',particles:'Petals'},
 winter:{seam:'assets/flat-join-winter.png',base:'assets/flat-winter.png',caption:'Winter · Snow over the village',particles:'Snowfall'}
};
const seasonCache=new Map();let seasonRequest=0,animationStarted=false,seasonBusy=false;
function setSeasonBusy(busy,target){
 seasonBusy=busy;
 const group=document.querySelector('.seasons');
 group.setAttribute('aria-busy',String(busy));
 for(const button of group.querySelectorAll('button')){
  button.disabled=busy;
  const arriving=busy&&button.dataset.season===target;
  button.classList.toggle('is-arriving',arriving);
  if(arriving)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');
 }
}
function loadPicture(src){return new Promise((resolve,reject)=>{const picture=new Image();picture.onload=()=>resolve(picture);picture.onerror=()=>reject(new Error('Landscape failed to load'));picture.src=src})}
async function selectSeason(key){
 if(!seasons[key])return;
 if(seasonBusy)return;
 if(loaded&&key===state.season)return;
 const request=++seasonRequest,config=seasons[key],status=document.querySelector('#season-status');
 status.textContent=`Flying into ${key}…`;setSeasonBusy(true,key);
 try{
  if(!seasonCache.has(key))seasonCache.set(key,Promise.all([loadPicture(config.base),loadPicture(config.seam)]).catch(error=>{seasonCache.delete(key);throw error}));
  const [base,landscape]=await seasonCache.get(key);if(request!==seasonRequest)return;
  if(loaded&&!reduced.matches)seasonTransition={terrain:copyCanvas(terrain),join:copyCanvas(seamRoad),water:copyCanvas(waterLayer),from:state.season,elapsed:0,duration:5.4,distance:H*1.60/zoom};
  state.season=key;prepareTerrain(base);prepareRoadJoin(null,landscape);loaded=true;dirty=true;resize();
  const caption=document.querySelector('#season-caption');caption.textContent=config.caption;caption.classList.remove('season-arrival');void caption.offsetWidth;caption.classList.add('season-arrival');
  document.querySelector('#particle-label').textContent=config.particles;
  for(const button of document.querySelectorAll('[data-season]'))button.setAttribute('aria-pressed',String(button.dataset.season===key));
  document.documentElement.dataset.season=key;
  status.textContent=seasonTransition?`Flying into ${key}…`:`Now flying through ${key}.`;
  try{localStorage.setItem('shirakawa-season',key)}catch{}
  const loading=document.querySelector('#loading');if(loading)loading.remove();
  if(!animationStarted){animationStarted=true;requestAnimationFrame(animate)}
 }catch(error){if(request===seasonRequest){status.textContent='Unable to load this season. Please try again.';const loading=document.querySelector('#loading');if(loading)loading.textContent=status.textContent}}
 finally{if(request===seasonRequest&&!seasonTransition)setSeasonBusy(false)}
}
for(const button of document.querySelectorAll('[data-season]'))button.onclick=()=>selectSeason(button.dataset.season);
let initialSeason='spring';try{initialSeason=localStorage.getItem('shirakawa-season')||'spring'}catch{}
selectSeason(seasons[initialSeason]?initialSeason:'spring');
const toggle=document.querySelector('#settings-toggle'),panel=document.querySelector('#settings-panel');function settings(open){panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Close settings':'Open settings')}
toggle.onclick=()=>settings(panel.hidden);document.querySelector('#close-settings').onclick=()=>{settings(false);toggle.focus()};document.addEventListener('pointerdown',e=>{if(!e.target.closest('.settings'))settings(false)});
function updatePlay(){document.querySelector('#play').setAttribute('aria-pressed',String(state.playing));dirty=true}document.querySelector('#play').onclick=()=>{state.playing=!state.playing;updatePlay()};updatePlay();
for(const key of ['cloud','snow','plane'])document.getElementById(key).onclick=()=>{state[key]=!state[key];document.getElementById(key).setAttribute('aria-pressed',String(state[key]));dirty=true};
document.querySelector('#speed').onchange=e=>state.speed=Number(e.target.value);

addEventListener('keydown',e=>{if(e.key==='Escape'){settings(false);toggle.focus()}if(e.code==='Space'&&!e.target.closest('button,select,input')){e.preventDefault();state.playing=!state.playing;updatePlay()}});
// Pinch and wheel zoom the scene while the aerial journey keeps moving.
function setZoom(value){zoom=Math.max(1,Math.min(2.5,value));dirty=true}
canvas.addEventListener('wheel',e=>{e.preventDefault();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?H:1);setZoom(zoom*Math.exp(-delta*.0015))},{passive:false});
const fingers=new Map();let pinchDistance=0,pinchZoom=1;
function beginPinch(){if(fingers.size===2){const [a,b]=[...fingers.values()];pinchDistance=Math.hypot(a.x-b.x,a.y-b.y);pinchZoom=zoom}else pinchDistance=0}
canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')return;canvas.setPointerCapture(e.pointerId);fingers.set(e.pointerId,{x:e.clientX,y:e.clientY});beginPinch()});
canvas.addEventListener('pointermove',e=>{if(!fingers.has(e.pointerId))return;fingers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(fingers.size===2&&pinchDistance>0){const [a,b]=[...fingers.values()];setZoom(pinchZoom*Math.hypot(a.x-b.x,a.y-b.y)/pinchDistance)}});
for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,e=>{fingers.delete(e.pointerId);beginPinch()});
reduced.addEventListener('change',e=>{if(e.matches){state.playing=false;updatePlay()}});

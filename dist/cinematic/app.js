import { createMotion } from './motion.js';
import { createVessel } from './vessel.js';

const $=s=>document.querySelector(s), duration=24;
const params=new URLSearchParams(location.search), embedded=params.has('embed');
document.body.dataset.embedded=String(embedded);
let delivered=false;
function notify(event){if(embedded)parent.postMessage({source:'normandy-startup',event},location.origin);try{window.webkit?.messageHandlers?.normandy?.postMessage({event});}catch{}}
function deliver(event){if(delivered)return;delivered=true;notify(event);}
const starts=[0,3.2,6.8,10,14.6,19], names=['SYSTEM WAKE','NORMANDY ARRIVAL','IDENTITY CONFIRMED','SKILLS SCAN','MCP DIRECTORY','COMMAND READY'];
const skills=['frontend-design','immersive','futuristic','playwright','imagegen','evidence-first-review','no-negative-echo','skill-creator'];
const mcps=[['filesystem','FILE SYSTEM'],['git','SOURCE CONTROL'],['fetch','NETWORK ACCESS'],['memory','MEMORY ARCHIVE']];
const clamp=n=>Math.max(0,Math.min(1,n)), ease=n=>1-Math.pow(1-clamp(n),3);
const motion=createMotion($('#motion'));
let vessel;
try { vessel=createVessel($('#vessel')); } catch(e) { console.error(e); $('#load-note').textContent='当前窗口无法创建 3D 画面，请换用支持 WebGL 的浏览器。'; document.body.dataset.state='error'; }
const scenes=[...document.querySelectorAll('.scene')], sheets=[...$('#transition').children];
let cues=[],raw,buffer,context,gain,source,state='loading',position=0,clockStart=0,muted=false,starting=false;
const rows={};
function populate(kind,items) {
  const list=$(`#${kind}-list`);
  list.replaceChildren();
  rows[kind]=items.slice(0,8).map((item,i)=>{const row=document.createElement('div');row.className='scan-row';const [name,label]=Array.isArray(item)?item:[item,null];
    const num=document.createElement('span');num.className='num';num.textContent=String(i+1).padStart(2,'0');
    const title=document.createElement('span');title.className='row-name';title.textContent=name;
    if(label){const small=document.createElement('small');small.textContent=label;title.append(small);}
    const status=document.createElement('span');status.className='row-state';status.textContent='STANDBY';row.append(num,title,status);list.append(row);return row;});
}
populate('skill',skills);populate('mcp',mcps);
async function inventory(){
  if(!embedded)return;
  let data;
  try{const response=await fetch(new URL('../../inventory',location.href),{signal:AbortSignal.timeout(3500)});if(!response.ok)throw Error(response.status);data=await response.json();}catch{data={mode:'unavailable',skills:[],mcps:[]};}
  const live=data.mode==='live';
  const lists={skill:live?data.skills:[],mcp:live?data.mcps.map(m=>[m.name,m.label]):[]};
  for(const kind of ['skill','mcp']){
    populate(kind,lists[kind]);const scene=$(`.${kind==='skill'?'skills':'mcp'}`);
    scene.querySelector('.demo-tag').textContent=live?`本地清单 · ${lists[kind].length} 项${lists[kind].length>8?' / 展示前 8 项':''}`:'清单读取暂不可用';
    if(!lists[kind].length){const empty=document.createElement('p');empty.className='inventory-empty';empty.textContent=live?'此目录未发现可用项目':'继续进入 DSH 查看配置';$(`#${kind}-list`).append(empty);}
    scene.querySelector('.map-caption strong').textContent=`${kind==='skill'?'SKILLS':'LINK'} / ${String(lists[kind].length).padStart(2,'0')}`;
  }
}
function resize(){const w=innerWidth,h=innerHeight,dpr=Math.min(devicePixelRatio||1,2);motion.resize(w,h,dpr);vessel?.resize(w,h,dpr);render(current());}
function current(){return state==='playing'?Math.min(duration,position+context.currentTime-clockStart):position;}
function setState(next){state=next;document.body.dataset.state=next;$('#pause-indicator').hidden=next!=='paused';$('#play').textContent=next==='playing'?'Ⅱ':'▷';$('#play').setAttribute('aria-label',next==='playing'?'暂停':'继续播放');}
function stopAudio(){if(source){try{source.stop();}catch{}source.disconnect();source=null;}}
function runAudio(){stopAudio();source=context.createBufferSource();source.buffer=buffer;source.connect(gain);clockStart=context.currentTime;source.start(clockStart,position);}
async function play(reset=false,automatic=false){
  if(starting||!raw||!vessel)return;
  starting=true;
  try{
    if(!context){context=new AudioContext();gain=context.createGain();gain.gain.value=muted?0:1;gain.connect(context.destination);}
    const resume=context.resume();
    if(automatic){await Promise.race([resume,new Promise(resolve=>setTimeout(resolve,800))]);if(context.state!=='running'){setState('standby');$('#start-label').textContent='开启声音并启动';return;}}
    else await resume;
    if(!buffer)buffer=await context.decodeAudioData(raw.slice(0));
    if(reset||position>=duration)position=0;
    runAudio();setState('playing');
  }catch(e){console.error(e);setState('error');$('#start-label').textContent='重新载入';$('#load-note').textContent='声音加载失败，请刷新后重试。';deliver('error');}
  finally{starting=false;}
}
function pause(){if(state!=='playing')return;position=current();stopAudio();setState('paused');render(position);}
function seek(t){const running=state==='playing';stopAudio();position=Math.max(0,Math.min(duration,t));if(position>=duration){finish();return;}else if(running){runAudio();setState('playing');}else setState('paused');render(position);}
function finish(event='complete'){stopAudio();position=duration;setState('complete');render(position);deliver(event);}
function toggleMute(){muted=!muted;if(gain)gain.gain.setTargetAtTime(muted?0:1,context.currentTime,.025);$('#mute').innerHTML=`声音 ${muted?'关':'开'} <kbd>M</kbd>`;$('#mute').setAttribute('aria-pressed',String(muted));}
function fullscreen(){if(document.fullscreenElement)document.exitFullscreen();else $('#experience').requestFullscreen?.().catch(console.error);}
function scan(kind,age,interval){let count=0;rows[kind].forEach((row,i)=>{const p=clamp((age-.66-i*interval)/.38),scanned=age>1.05+i*interval;row.style.opacity=String(p);row.style.transform=`translateX(${(1-ease(p))*80}px)`;row.style.setProperty('--scan-x',`${(clamp((age-.66-i*interval)/.7)*210-100)}%`);row.classList.toggle('done',scanned);row.querySelector('.row-state').textContent=scanned?(kind==='skill'?'INDEXED':'MAPPED'):'SCANNING';if(scanned)count++;});$(`#${kind}-count`).textContent=`${String(count).padStart(2,'0')} / ${String(rows[kind].length).padStart(2,'0')}`;$(`#${kind}-status`).textContent=count===rows[kind].length?(kind==='skill'?'CAPABILITY MAP COMPLETE':'DIRECTORY MAP COMPLETE'):(kind==='skill'?'MAPPING CAPABILITIES':'READING CONFIGURATION');}
function render(t){
  motion.update(t);vessel?.update(t);
  const phase=Math.max(0,starts.findLastIndex(s=>t>=s)),age=t-starts[phase];
  scenes.forEach((scene,i)=>{const active=i===phase;scene.classList.toggle('active',active);scene.setAttribute('aria-hidden',String(!active));if(!active)return;
    for(const el of scene.querySelectorAll('[data-reveal]')){const p=ease((age-Number(el.dataset.reveal))/.65);el.style.opacity=String(p);el.style.translate=`0 ${(1-p)*65}px`;el.style.clipPath=`inset(${(1-p)*100}% 0 0 0)`;}
  });
  // Offset the three shutters independently, as in a physical aperture.
  sheets.forEach((el,i)=>{const p=clamp((age-i*.065)/.57);el.style.opacity=phase>0&&age<.85?'1':'0';el.style.transform=`translateX(${(-8-ease(p)*125)}%) skewX(-26deg)`;});
  if(phase===2){const symbols='0123456789ABCDEF';$('#cipher').textContent=age>1.9?'5923 · AC · 2816 · VERIFIED':Array.from({length:24},(_,i)=>symbols[(Math.floor(age*26)*7+i*11)%16]).join('');}
  if(phase===3)scan('skill',age,2.45/Math.max(1,rows.skill.length-1));if(phase===4)scan('mcp',age,2.1/Math.max(1,rows.mcp.length-1));
  const cue=cues.find(c=>t>=c.at_seconds&&t<c.end_seconds+.18);$('#subtitle').style.opacity=cue?'1':'0';
  if(cue){$('#subtitle-cn').textContent=cue.subtitle;$('#subtitle-en').textContent=cue.text;document.querySelectorAll('.voice-bars i').forEach((el,i)=>el.style.height=`${3+Math.abs(Math.sin(t*13+i*1.8))*16}px`);}
  $('#seek').value=t;$('#seek').style.setProperty('--progress',`${t/duration*100}%`);$('#time').textContent=`${t.toFixed(2).padStart(5,'0')} / 24.00`;$('#phase-name').textContent=names[phase];
  [...$('#chapters').children].forEach((el,i)=>el.classList.toggle('current',i===phase));
  $('#experience').dataset.elapsed=t.toFixed(3);document.body.dataset.phase=String(phase);
}
function tick(){if(state==='playing'){const t=current();if(t>=duration)finish();else render(t);}requestAnimationFrame(tick);}
$('#start').onclick=()=>play(true);$('#replay').onclick=()=>play(true);$('#play').onclick=()=>state==='playing'?pause():play();$('#mute').onclick=toggleMute;$('#skip').onclick=()=>finish('skip');$('#fullscreen').onclick=fullscreen;$('#seek').oninput=e=>seek(Number(e.target.value));
document.addEventListener('keydown',e=>{if(e.target.matches('input,button')&&e.code==='Space')return;if(e.code==='Space'){e.preventDefault();state==='playing'?pause():play();}if(e.key.toLowerCase()==='r')play(true);if(e.key.toLowerCase()==='m')toggleMute();if(e.key.toLowerCase()==='f')fullscreen();if(e.key==='Escape'&&!document.fullscreenElement)finish('skip');});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});window.addEventListener('resize',resize);
window.addEventListener('pagehide',()=>{stopAudio();context?.close();});
resize();requestAnimationFrame(tick);
try{
  const [audio,meta]=await Promise.all([fetch('./assets/cinematic.wav').then(r=>{if(!r.ok)throw Error(r.status);return r.arrayBuffer();}),fetch('./assets/cinematic-audio.json').then(r=>{if(!r.ok)throw Error(r.status);return r.json();}),document.fonts.ready,inventory()]);raw=audio;cues=meta.voice_cues;
  if(vessel){setState('standby');$('#start').disabled=false;$('#start-label').textContent='启动诺曼底';$('#load-note').textContent='空格暂停 · M 静音 · Esc 跳过';render(2);notify('ready');if(params.has('autoplay'))play(true,true);}else deliver('error');
}catch(e){console.error(e);setState('error');$('#start-label').textContent='载入失败';$('#load-note').textContent='请确认通过本地预览服务打开，再刷新。';deliver('error');}
// Deterministic rendering support for the local preview capture.
if(new URLSearchParams(location.search).has('capture')){document.body.dataset.capture='true';window.cinematic={seek(t){stopAudio();position=t;setState('paused');$('#pause-indicator').hidden=true;render(t);},play:()=>play(true),get status(){return{state,time:current(),muted,audioTime:context?.currentTime,duration:buffer?.duration};}};}

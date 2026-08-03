(()=>{
'use strict';
const MEALS=[
{id:'breakfast',name:'Breakfast',action:'breakfast',icon:'🍳',bg:'#fff0c9'},
{id:'lunch',name:'Lunch',action:'lunch',icon:'🥪',bg:'#dff3e7'},
{id:'dinner',name:'Dinner',action:'dinner',icon:'🍝',bg:'#ffe0d8'},
{id:'snacks',name:'Snacks & drinks',action:'snacks or drinks',icon:'🍎',bg:'#e8e2ff'}
];
const $=id=>document.getElementById(id);
const enc=new TextEncoder(),dec=new TextDecoder();
const deviceId=localStorage.stinkyDeviceId||(localStorage.stinkyDeviceId=crypto.randomUUID());
let viewerName=localStorage.stinkyViewerName||'';
let room='',syncTopic='',alertTopic='',aesKey=null,state=null,eventSource=null,pollTimer=null,publishTimer=null;
const today=()=>new Date().toLocaleDateString('en-CA');
const blank=()=>({version:7,date:today(),updatedAt:0,updatedBy:'',deviceId:'',meals:Object.fromEntries(MEALS.map(m=>[m.id,{done:false,text:'',at:0,by:''}]))});
const normalise=s=>String(s||'').toUpperCase().replace(/[^A-Z2-9]/g,'').replace(/[01OI]/g,'');
const format=s=>(normalise(s).match(/.{1,4}/g)||[]).join('-');
const randomRoom=()=>{const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=crypto.getRandomValues(new Uint8Array(12));return format([...bytes].map(v=>alphabet[v%alphabet.length]).join(''))};
const hex=b=>[...new Uint8Array(b)].map(v=>v.toString(16).padStart(2,'0')).join('');
const hash=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value)));
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=value=>{let s=value.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return Uint8Array.from(atob(s),c=>c.charCodeAt(0))};
const storageKey=()=>`stinkyV7:${room}:${today()}`;
function normaliseState(input){const next=blank();if(!input||typeof input!=='object')return next;next.updatedAt=Number(input.updatedAt)||0;next.updatedBy=String(input.updatedBy||'');next.deviceId=String(input.deviceId||'');MEALS.forEach(m=>{const source=input.meals?.[m.id]||{};next.meals[m.id]={done:Boolean(source.done),text:String(source.text||''),at:Number(source.at)||0,by:String(source.by||'')}});return next}
async function setup(code){room=normalise(code);if(room.length<8)throw new Error('Invalid room');const topicHash=hex(await hash('stinky-sync-topic-v7:'+room));const alertHash=hex(await hash('stinky-alert-v1:'+room));syncTopic='stinky-sync-'+topicHash.slice(0,48);alertTopic='stinky-'+alertHash.slice(0,48);aesKey=await crypto.subtle.importKey('raw',await hash('stinky-sync-key-v7:'+room),{name:'AES-GCM'},false,['encrypt','decrypt'])}
async function encrypt(value){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},aesKey,enc.encode(JSON.stringify(value)));return JSON.stringify({v:1,i:b64(iv),d:b64(encrypted)})}
async function decrypt(value){const packet=JSON.parse(value);const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(packet.i)},aesKey,unb64(packet.d));return JSON.parse(dec.decode(clear))}
function buildMeals(){$('mealGrid').innerHTML='';MEALS.forEach(meal=>{const card=document.createElement('article');card.className='meal';card.dataset.meal=meal.id;card.innerHTML=`<div class="stamp"><span>✓</span></div><div class="meal-head"><div class="meal-icon" style="background:${meal.bg}">${meal.icon}</div><div class="meal-title"><h3>${meal.name}</h3><small data-subtitle>Tap after eating</small></div><span class="pill" data-pill>Not yet</span></div><div class="meal-body"><label for="food-${meal.id}">What did you have? (optional)</label><textarea id="food-${meal.id}" data-text placeholder="Type it here if you want"></textarea><button type="button" class="check-btn" data-check><span class="check-box" data-box>${meal.icon}</span><span class="check-copy"><strong data-button-label>I ate ${meal.action}</strong><small data-button-sub>Tap once — Charlie will be told</small></span></button></div>`;const input=card.querySelector('[data-text]');const button=card.querySelector('[data-check]');input.addEventListener('input',()=>{state.meals[meal.id].text=input.value;saveLocal();clearTimeout(publishTimer);publishTimer=setTimeout(publishState,350)});button.addEventListener('click',()=>toggleMeal(meal.id));$('mealGrid').appendChild(card)})}
function render(){if(!state)return;let done=0;MEALS.forEach(meal=>{const value=state.meals[meal.id],card=document.querySelector(`[data-meal="${meal.id}"]`);if(!card)return;if(value.done)done++;card.classList.toggle('done',value.done);card.querySelector('[data-pill]').textContent=value.done?'Eaten ✓':'Not yet';card.querySelector('[data-subtitle]').textContent=value.done?`${value.by||'Stinky'} checked it${value.at?' at '+new Date(value.at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):''}`:'Tap after eating';card.querySelector('[data-box]').textContent=value.done?'✓':meal.icon;card.querySelector('[data-button-label]').textContent=value.done?`${meal.name} eaten — tap to undo`:`I ate ${meal.action}`;card.querySelector('[data-button-sub]').textContent=value.done?'Checked on both phones':'Tap once — Charlie will be told';const input=card.querySelector('[data-text]');if(document.activeElement!==input&&input.value!==value.text)input.value=value.text});const pct=done*25;$('ring').style.setProperty('--pct',String(pct));$('percent').textContent=pct+'%';$('progressTitle').textContent=done===4?'Everything is checked!':`${done} of 4 checked`;$('progressText').textContent=done===4?'Breakfast, lunch, dinner and snacks are complete.':'The progress changes immediately on each tap.';$('steps').innerHTML=MEALS.map((m,index)=>`<div class="step ${state.meals[m.id].done?'done':''}"><b>${state.meals[m.id].done?'✓':index+1}</b><small>${m.name.replace(' & drinks','')}</small></div>`).join('')}
function saveLocal(){localStorage.setItem(storageKey(),JSON.stringify(state))}
function makeChange(){state.updatedAt=Date.now();state.updatedBy=viewerName||'Stinky';state.deviceId=deviceId;saveLocal();render()}
function toggleMeal(id){const meal=MEALS.find(m=>m.id===id),value=state.meals[id];value.done=!value.done;value.at=value.done?Date.now():0;value.by=value.done?(viewerName||'Stinky'):'';makeChange();if(navigator.vibrate)navigator.vibrate(value.done?[80,40,100]:40);publishState();if(value.done){publishAlert(meal);toast(`${meal.name} is green and checked ✓`)}else toast(`${meal.name} unticked`)}
async function publishState(){if(!aesKey||!state)return;try{const payload=await encrypt(state);await fetch(`https://ntfy.sh/${encodeURIComponent(syncTopic)}`,{method:'POST',mode:'no-cors',cache:'no-store',body:payload});setSync(true,'Live sync sent')}catch{setSync(false,'Saved here — retrying sync');setTimeout(publishState,1200)}}
async function publishAlert(meal){const message=`${state.updatedBy||'Stinky'} ate ${meal.action} ✓`;const click=`${location.origin}${location.pathname}#r=${room}`;const url=`https://ntfy.sh/${encodeURIComponent(alertTopic)}?title=${encodeURIComponent("Stinky's Checklist")}&priority=4&tags=white_check_mark&click=${encodeURIComponent(click)}`;fetch(url,{method:'POST',mode:'no-cors',body:message}).catch(()=>{})}
async function processEnvelope(raw){try{const envelope=typeof raw==='string'?JSON.parse(raw):raw;if(envelope.event&&envelope.event!=='message')return;const incoming=normaliseState(await decrypt(envelope.message));if(incoming.date!==today())return;if(incoming.updatedAt>state.updatedAt){state=incoming;saveLocal();render();toast('Updated from the other phone ✓')}}catch{}}
function startLive(){try{eventSource?.close();eventSource=new EventSource(`https://ntfy.sh/${encodeURIComponent(syncTopic)}/sse?since=all&_=${Date.now()}`);eventSource.onopen=()=>setSync(true,'Live sync connected');eventSource.onmessage=e=>processEnvelope(e.data);eventSource.onerror=()=>setSync(false,'Live connection retrying…')}catch{setSync(false,'Using backup sync')}clearInterval(pollTimer);pollTimer=setInterval(pollLatest,1500);pollLatest()}
async function pollLatest(){try{const response=await fetch(`https://ntfy.sh/${encodeURIComponent(syncTopic)}/json?poll=1&since=all&_=${Date.now()}`,{cache:'no-store'});const text=await response.text();for(const line of text.trim().split('\n'))if(line)await processEnvelope(line);setSync(true,eventSource?.readyState===1?'Live sync connected':'Backup sync active')}catch{setSync(false,'Waiting for internet…')}}
function setSync(live,text){$('syncDot').classList.toggle('live',live);$('syncText').textContent=text}
async function enter(code){await setup(code);localStorage.stinkyRecentRoom=room;location.hash='r='+room;$('welcome').classList.add('hidden');$('app').classList.remove('hidden');$('roomLabel').textContent='Private code '+format(room);state=normaliseState(JSON.parse(localStorage.getItem(storageKey())||'null'));buildMeals();render();startLive()}
function toast(text){const el=$('toast');el.textContent=text;el.classList.add('show');clearTimeout(el.timer);el.timer=setTimeout(()=>el.classList.remove('show'),1800)}
async function share(){const url=`${location.origin}${location.pathname}#r=${room}`;try{if(navigator.share)await navigator.share({title:"Stinky's Checklist",text:'Open our shared meal checklist:',url});else{await navigator.clipboard.writeText(url);toast('Private link copied')}}catch{}}
$('create').addEventListener('click',()=>enter(randomRoom()));
$('settings').addEventListener('click',()=>{$('viewerName').value=viewerName;$('settingsSheet').classList.remove('hidden')});
$('closeSettings').addEventListener('click',()=>$('settingsSheet').classList.add('hidden'));
$('settingsSheet').addEventListener('click',e=>{if(e.target===$('settingsSheet'))$('settingsSheet').classList.add('hidden')});
$('saveName').addEventListener('click',()=>{viewerName=$('viewerName').value.trim();localStorage.stinkyViewerName=viewerName;toast('Name saved')});
$('share').addEventListener('click',share);
$('copyNtfy').addEventListener('click',async()=>{$('topic').textContent=alertTopic;$('topic').classList.remove('hidden');try{await navigator.clipboard.writeText(alertTopic);toast('ntfy code copied')}catch{toast('Code shown below')}});
$('reset').addEventListener('click',()=>{if(!confirm('Untick all four meals today?'))return;state=blank();makeChange();publishState();toast('Today reset')});
window.addEventListener('online',()=>{startLive();publishState()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){pollLatest();startLive();render()}});
setInterval(()=>{if(state&&state.updatedAt>0&&navigator.onLine)publishState()},60000);
const params=new URLSearchParams(location.hash.replace(/^#/,'')),code=params.get('r'),recent=localStorage.stinkyRecentRoom;
if(recent){$('recent').classList.remove('hidden');$('recent').textContent='Open recent shared checklist';$('recent').addEventListener('click',()=>enter(recent))}
if(code)enter(code).catch(()=>toast('That private link is not valid'));else if(recent&&(window.matchMedia('(display-mode: standalone)').matches||navigator.standalone))enter(recent).catch(()=>{});
if('serviceWorker'in navigator){navigator.serviceWorker.register('./sw.js?v=7').then(reg=>reg.update()).catch(()=>{})}
})();

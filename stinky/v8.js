(()=>{
'use strict';

const MEALS=[
  {id:'breakfast',name:'Breakfast',action:'breakfast',icon:'🍳',bg:'#fff0c9'},
  {id:'lunch',name:'Lunch',action:'lunch',icon:'🥪',bg:'#dff3e7'},
  {id:'dinner',name:'Dinner',action:'dinner',icon:'🍝',bg:'#ffe0d8'},
  {id:'snacks',name:'Snacks & drinks',action:'snacks or drinks',icon:'🍎',bg:'#e8e2ff'}
];

const $=id=>document.getElementById(id);
const encoder=new TextEncoder();
const decoder=new TextDecoder();
const deviceId=localStorage.stinkyDeviceId||(localStorage.stinkyDeviceId=crypto.randomUUID());
let viewerName=localStorage.stinkyViewerName||'';
let room='';
let syncTopic='';
let alertTopic='';
let aesKey=null;
let state=null;
let eventSource=null;
let fallbackTimer=null;
let publishTimer=null;
let retryTimer=null;

const today=()=>new Date().toLocaleDateString('en-CA');
const normalise=value=>String(value||'').toUpperCase().replace(/[^A-Z2-9]/g,'').replace(/[01OI]/g,'');
const format=value=>(normalise(value).match(/.{1,4}/g)||[]).join('-');
const blankState=()=>({
  version:8,
  date:today(),
  updatedAt:0,
  updatedBy:'',
  deviceId:'',
  meals:Object.fromEntries(MEALS.map(meal=>[meal.id,{done:false,text:'',at:0,by:''}]))
});
const randomRoom=()=>{
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes=crypto.getRandomValues(new Uint8Array(12));
  return format([...bytes].map(value=>alphabet[value%alphabet.length]).join(''));
};
const hex=buffer=>[...new Uint8Array(buffer)].map(value=>value.toString(16).padStart(2,'0')).join('');
const hash=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=value=>{
  let text=value.replace(/-/g,'+').replace(/_/g,'/');
  while(text.length%4)text+='=';
  return Uint8Array.from(atob(text),character=>character.charCodeAt(0));
};
const storageKey=()=>`stinkyV8:${room}:${today()}`;

function normaliseState(input){
  const next=blankState();
  if(!input||typeof input!=='object')return next;
  next.updatedAt=Number(input.updatedAt)||0;
  next.updatedBy=String(input.updatedBy||'');
  next.deviceId=String(input.deviceId||'');
  MEALS.forEach(meal=>{
    const source=input.meals?.[meal.id]||{};
    next.meals[meal.id]={
      done:Boolean(source.done),
      text:String(source.text||''),
      at:Number(source.at)||0,
      by:String(source.by||'')
    };
  });
  return next;
}

async function setup(code){
  room=normalise(code);
  if(room.length<8)throw new Error('Invalid room');
  const syncHash=hex(await hash('stinky-sync-topic-v8:'+room));
  const alertHash=hex(await hash('stinky-alert-v1:'+room));
  syncTopic='stinky-sync-'+syncHash.slice(0,48);
  alertTopic='stinky-'+alertHash.slice(0,48);
  aesKey=await crypto.subtle.importKey(
    'raw',
    await hash('stinky-sync-key-v8:'+room),
    {name:'AES-GCM'},
    false,
    ['encrypt','decrypt']
  );
}

async function encrypt(value){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt(
    {name:'AES-GCM',iv},
    aesKey,
    encoder.encode(JSON.stringify(value))
  );
  return JSON.stringify({v:1,i:b64(iv),d:b64(encrypted)});
}

async function decrypt(value){
  const packet=JSON.parse(value);
  const clear=await crypto.subtle.decrypt(
    {name:'AES-GCM',iv:unb64(packet.i)},
    aesKey,
    unb64(packet.d)
  );
  return JSON.parse(decoder.decode(clear));
}

function buildMeals(){
  $('mealGrid').innerHTML='';
  MEALS.forEach(meal=>{
    const card=document.createElement('article');
    card.className='meal';
    card.dataset.meal=meal.id;
    card.innerHTML=`
      <div class="stamp"><span>✓</span></div>
      <div class="meal-head">
        <div class="meal-icon" style="background:${meal.bg}">${meal.icon}</div>
        <div class="meal-title"><h3>${meal.name}</h3><small data-subtitle>Tap after eating</small></div>
        <span class="pill" data-pill>Not yet</span>
      </div>
      <div class="meal-body">
        <label for="food-${meal.id}">What did you have? (optional)</label>
        <textarea id="food-${meal.id}" data-text placeholder="Type it here if you want"></textarea>
        <button type="button" class="check-btn" data-check>
          <span class="check-box" data-box>${meal.icon}</span>
          <span class="check-copy">
            <strong data-button-label>I ate ${meal.action}</strong>
            <small data-button-sub>Tap once — Charlie will be told</small>
          </span>
        </button>
      </div>`;

    const input=card.querySelector('[data-text]');
    input.addEventListener('input',()=>{
      state.meals[meal.id].text=input.value;
      saveLocal();
      clearTimeout(publishTimer);
      publishTimer=setTimeout(publishState,2000);
    });
    input.addEventListener('blur',publishState);
    card.querySelector('[data-check]').addEventListener('click',()=>toggleMeal(meal.id));
    $('mealGrid').appendChild(card);
  });
}

function render(){
  if(!state)return;
  let completed=0;
  MEALS.forEach(meal=>{
    const value=state.meals[meal.id];
    const card=document.querySelector(`[data-meal="${meal.id}"]`);
    if(!card)return;
    if(value.done)completed++;
    card.classList.toggle('done',value.done);
    card.querySelector('[data-pill]').textContent=value.done?'Eaten ✓':'Not yet';
    card.querySelector('[data-subtitle]').textContent=value.done
      ?`${value.by||'Stinky'} checked it${value.at?' at '+new Date(value.at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):''}`
      :'Tap after eating';
    card.querySelector('[data-box]').textContent=value.done?'✓':meal.icon;
    card.querySelector('[data-button-label]').textContent=value.done
      ?`${meal.name} eaten — tap to undo`
      :`I ate ${meal.action}`;
    card.querySelector('[data-button-sub]').textContent=value.done
      ?'Green and checked on both phones'
      :'Tap once — Charlie will be told';
    const input=card.querySelector('[data-text]');
    if(document.activeElement!==input&&input.value!==value.text)input.value=value.text;
  });

  const percentage=completed*25;
  $('ring').style.setProperty('--pct',String(percentage));
  $('percent').textContent=percentage+'%';
  $('progressTitle').textContent=completed===4?'Everything is checked!':`${completed} of 4 checked`;
  $('progressText').textContent=completed===4
    ?'Breakfast, lunch, dinner and snacks are complete.'
    :'The progress changes immediately on every tap.';
  $('steps').innerHTML=MEALS.map((meal,index)=>`
    <div class="step ${state.meals[meal.id].done?'done':''}">
      <b>${state.meals[meal.id].done?'✓':index+1}</b>
      <small>${meal.name.replace(' & drinks','')}</small>
    </div>`).join('');
}

function saveLocal(){
  localStorage.setItem(storageKey(),JSON.stringify(state));
}

function markChanged(){
  state.updatedAt=Date.now();
  state.updatedBy=viewerName||'Stinky';
  state.deviceId=deviceId;
  saveLocal();
  render();
}

function toggleMeal(id){
  const meal=MEALS.find(item=>item.id===id);
  const value=state.meals[id];
  value.done=!value.done;
  value.at=value.done?Date.now():0;
  value.by=value.done?(viewerName||'Stinky'):'';

  // The visual state changes before any network request.
  markChanged();
  if(navigator.vibrate)navigator.vibrate(value.done?[80,40,100]:40);
  publishState();

  if(value.done){
    publishAlert(meal);
    toast(`${meal.name} turned green ✓`);
  }else{
    toast(`${meal.name} unticked`);
  }
}

async function publishState(){
  if(!aesKey||!state||!navigator.onLine)return;
  clearTimeout(retryTimer);
  try{
    const payload=await encrypt(state);
    await fetch(`https://ntfy.sh/${encodeURIComponent(syncTopic)}`,{
      method:'POST',
      mode:'no-cors',
      cache:'no-store',
      body:payload
    });
    setSync(true,'Live sync connected');
  }catch{
    setSync(false,'Saved here — retrying shortly');
    retryTimer=setTimeout(publishState,10000);
  }
}

function publishAlert(meal){
  const message=`${state.updatedBy||'Stinky'} ate ${meal.action} ✓`;
  const click=`${location.origin}${location.pathname}#r=${room}`;
  const query=new URLSearchParams({
    title:"Stinky's Checklist",
    priority:'4',
    tags:'white_check_mark',
    click
  });
  fetch(`https://ntfy.sh/${encodeURIComponent(alertTopic)}?${query}`,{
    method:'POST',
    mode:'no-cors',
    body:message
  }).catch(()=>{});
}

async function processEnvelope(raw){
  try{
    const envelope=typeof raw==='string'?JSON.parse(raw):raw;
    if(envelope.event&&envelope.event!=='message')return;
    const incoming=normaliseState(await decrypt(envelope.message));
    if(incoming.date!==today())return;
    if(incoming.updatedAt>state.updatedAt){
      state=incoming;
      saveLocal();
      render();
      toast('Updated instantly from the other phone ✓');
    }
  }catch{}
}

function clearFallback(){
  clearInterval(fallbackTimer);
  fallbackTimer=null;
}

function startFallback(){
  if(fallbackTimer)return;
  fallbackTimer=setInterval(()=>{
    if(!eventSource||eventSource.readyState!==EventSource.OPEN)pollLatest();
  },30000);
}

function startLive(){
  eventSource?.close();
  clearFallback();
  try{
    eventSource=new EventSource(`https://ntfy.sh/${encodeURIComponent(syncTopic)}/sse?since=12h&_=${Date.now()}`);
    eventSource.onopen=()=>{
      clearFallback();
      setSync(true,'Live sync connected');
    };
    eventSource.onmessage=event=>processEnvelope(event.data);
    eventSource.onerror=()=>{
      setSync(false,'Live connection retrying…');
      startFallback();
    };
  }catch{
    setSync(false,'Using backup sync');
    startFallback();
  }
}

async function pollLatest(){
  if(!navigator.onLine)return;
  try{
    const response=await fetch(
      `https://ntfy.sh/${encodeURIComponent(syncTopic)}/json?poll=1&since=10m&_=${Date.now()}`,
      {cache:'no-store'}
    );
    if(response.status===429){
      setSync(false,'ntfy cooling down — live sync will retry');
      return;
    }
    const text=await response.text();
    for(const line of text.trim().split('\n')){
      if(line)await processEnvelope(line);
    }
  }catch{}
}

function setSync(live,text){
  $('syncDot').classList.toggle('live',live);
  $('syncText').textContent=text;
}

async function enter(code){
  await setup(code);
  localStorage.stinkyRecentRoom=room;
  location.hash='r='+room;
  $('welcome').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('roomLabel').textContent='Private code '+format(room);
  state=normaliseState(JSON.parse(localStorage.getItem(storageKey())||'null'));
  buildMeals();
  render();
  startLive();
}

function toast(text){
  const element=$('toast');
  element.textContent=text;
  element.classList.add('show');
  clearTimeout(element.timer);
  element.timer=setTimeout(()=>element.classList.remove('show'),1800);
}

async function share(){
  const url=`${location.origin}${location.pathname}#r=${room}`;
  try{
    if(navigator.share)await navigator.share({title:"Stinky's Checklist",text:'Open our shared meal checklist:',url});
    else{
      await navigator.clipboard.writeText(url);
      toast('Private link copied');
    }
  }catch{}
}

$('create').addEventListener('click',()=>enter(randomRoom()));
$('settings').addEventListener('click',()=>{
  $('viewerName').value=viewerName;
  $('settingsSheet').classList.remove('hidden');
});
$('closeSettings').addEventListener('click',()=>$('settingsSheet').classList.add('hidden'));
$('settingsSheet').addEventListener('click',event=>{
  if(event.target===$('settingsSheet'))$('settingsSheet').classList.add('hidden');
});
$('saveName').addEventListener('click',()=>{
  viewerName=$('viewerName').value.trim();
  localStorage.stinkyViewerName=viewerName;
  toast('Name saved');
});
$('share').addEventListener('click',share);
$('copyNtfy').addEventListener('click',async()=>{
  $('topic').textContent=alertTopic;
  $('topic').classList.remove('hidden');
  try{
    await navigator.clipboard.writeText(alertTopic);
    toast('ntfy code copied');
  }catch{
    toast('Code shown below');
  }
});
$('reset').addEventListener('click',()=>{
  if(!confirm('Untick all four meals today?'))return;
  state=blankState();
  markChanged();
  publishState();
  toast('Today reset');
});

window.addEventListener('online',()=>{
  startLive();
  publishState();
});
window.addEventListener('offline',()=>setSync(false,'Offline — saved on this phone'));
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden){
    render();
    if(!eventSource||eventSource.readyState===EventSource.CLOSED)startLive();
  }
});

const params=new URLSearchParams(location.hash.replace(/^#/,''));
const code=params.get('r');
const recent=localStorage.stinkyRecentRoom;
if(recent){
  $('recent').classList.remove('hidden');
  $('recent').textContent='Open recent shared checklist';
  $('recent').addEventListener('click',()=>enter(recent));
}
if(code){
  enter(code).catch(()=>toast('That private link is not valid'));
}else if(recent&&(window.matchMedia('(display-mode: standalone)').matches||navigator.standalone)){
  enter(recent).catch(()=>{});
}

// Remove all older service workers and caches that caused stale versions.
if('serviceWorker'in navigator){
  navigator.serviceWorker.getRegistrations().then(registrations=>registrations.forEach(registration=>registration.unregister())).catch(()=>{});
}
if('caches'in window){
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('stinky-checklist')).map(key=>caches.delete(key)))).catch(()=>{});
}
})();

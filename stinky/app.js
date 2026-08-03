(()=>{
'use strict';
const RELAYS=['wss://relay.damus.io','wss://nos.lol','wss://relay.snort.social'];
const STATE_KIND=30078,PRESENCE_KIND=20001;
const meals=[
  {id:'breakfast',name:'Breakfast',action:'breakfast',icon:'🍳',bg:'#fff0c9',placeholder:'What did you have? (optional)'},
  {id:'lunch',name:'Lunch',action:'lunch',icon:'🥪',bg:'#dff3e7',placeholder:'What did you have? (optional)'},
  {id:'dinner',name:'Dinner',action:'dinner',icon:'🍝',bg:'#ffe0d8',placeholder:'What did you have? (optional)'},
  {id:'snacks',name:'Snacks & drinks',action:'snacks or drinks',icon:'🍎',bg:'#e8e2ff',placeholder:'What snacks or drinks did you have? (optional)'}
];
const $=id=>document.getElementById(id);
const enc=new TextEncoder(),dec=new TextDecoder();
const deviceId=localStorage.stinkyDeviceId||(localStorage.stinkyDeviceId=crypto.randomUUID());
let viewerName=localStorage.stinkyViewerName||'',roomCode='',roomTag='',secretKey=null,pubkey='',aesKey=null,ntfyTopic='';
let state=null,selectedDate=new Date(),sockets=new Map(),presence=new Map(),publishTimer=null,reconnectTimers=new Map();
let hadCache=false,historyReady=false,swRegistration=null,deferredInstallPrompt=null;
const inputTimers=new Map();
selectedDate.setHours(12,0,0,0);

const blankMeal=()=>({text:'',done:false,by:'',doneAt:0,updatedAt:0});
const blankState=()=>({version:4,name:'Stinky',emoji:'🐶',days:{},updatedAt:0,updatedBy:'',updatedByDevice:'',lastAction:null});
const normaliseCode=s=>String(s||'').toUpperCase().replace(/[^A-Z2-9]/g,'').replace(/[01OI]/g,'');
const formatCode=s=>normaliseCode(s).match(/.{1,4}/g)?.join('-')||'';
const randomCode=()=>{const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='';crypto.getRandomValues(new Uint8Array(12)).forEach(v=>s+=a[v%a.length]);return formatCode(s)};
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=s=>{s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return Uint8Array.from(atob(s),c=>c.charCodeAt(0))};
const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)));
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateKeyFor=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const dateKey=()=>dateKeyFor(selectedDate);
const cacheKey=()=>`stinkyState:${normaliseCode(roomCode)}`;
const seenKey=()=>`stinkySeenAction:${normaliseCode(roomCode)}`;
const alertsOn=()=>localStorage.stinkyAlerts==='on'&&window.Notification?.permission==='granted';
const reliableSetup=()=>localStorage.getItem(`stinkyReliable:${normaliseCode(roomCode)}`)==='yes';

function convertMeal(value){
  if(Array.isArray(value)){
    const text=value.map(x=>x?.text).filter(Boolean).join(', ');
    const completed=value.find(x=>x?.done);
    return {text,done:Boolean(completed),by:completed?.by||'',doneAt:completed?.doneAt||0,updatedAt:Date.now()};
  }
  return {...blankMeal(),...(value&&typeof value==='object'?value:{})};
}
function normaliseState(value){
  const s={...blankState(),...(value&&typeof value==='object'?value:{})};
  s.days=s.days&&typeof s.days==='object'?s.days:{};
  Object.keys(s.days).forEach(key=>{
    const source=s.days[key]&&typeof s.days[key]==='object'?s.days[key]:{};
    const next={};meals.forEach(m=>next[m.id]=convertMeal(source[m.id]));s.days[key]=next;
  });
  s.version=4;return s;
}
function getDay(key=dateKey(),target=state){
  target.days[key] ||= {};
  meals.forEach(m=>target.days[key][m.id]=convertMeal(target.days[key][m.id]));
  return target.days[key];
}

async function setupRoom(code){
  roomCode=formatCode(code);
  if(normaliseCode(roomCode).length<8)throw Error('Code is too short');
  secretKey=await hash('stinky-signing-v1:'+normaliseCode(roomCode));
  pubkey=NostrTools.getPublicKey(secretKey);
  roomTag=hex(await hash('stinky-room-v1:'+normaliseCode(roomCode))).slice(0,40);
  ntfyTopic='stinky-'+hex(await hash('stinky-alert-v1:'+normaliseCode(roomCode))).slice(0,48);
  aesKey=await crypto.subtle.importKey('raw',await hash('stinky-encryption-v1:'+normaliseCode(roomCode)),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function encrypt(obj){const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},aesKey,enc.encode(JSON.stringify(obj)));return JSON.stringify({v:1,i:b64(iv),d:b64(data)})}
async function decrypt(content){const x=JSON.parse(content);const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(x.i)},aesKey,unb64(x.d));return JSON.parse(dec.decode(data))}
function signed(kind,content,tags=[]){return NostrTools.finalizeEvent({kind,created_at:Math.floor(Date.now()/1000),tags:[['d',roomTag],['t','stinky-checklist'],...tags],content},secretKey)}

function connectAll(){RELAYS.forEach(connectRelay)}
function connectRelay(url){
  if(sockets.get(url)?.readyState===WebSocket.OPEN||sockets.get(url)?.readyState===WebSocket.CONNECTING)return;
  let ws;try{ws=new WebSocket(url)}catch{return}
  sockets.set(url,ws);
  ws.onopen=()=>{
    clearTimeout(reconnectTimers.get(url));updateConnection();
    ws.send(JSON.stringify(['REQ','stinky-'+deviceId.slice(0,8),{kinds:[STATE_KIND,PRESENCE_KIND],authors:[pubkey],'#d':[roomTag],limit:100}]));
    sendPresence();
  };
  ws.onmessage=async e=>{
    let m;try{m=JSON.parse(e.data)}catch{return}
    if(m[0]==='EOSE'){historyReady=true;return}
    if(m[0]!=='EVENT')return;
    const ev=m[2];if(!ev||ev.pubkey!==pubkey)return;
    try{
      if(NostrTools.verifyEvent&&!NostrTools.verifyEvent(ev))return;
      if(ev.kind===STATE_KIND){
        const incoming=normaliseState(await decrypt(ev.content));
        if(!incoming?.days)return;
        if(!state||Number(incoming.updatedAt)>Number(state.updatedAt)){
          if(historyReady||hadCache)maybeAlert(incoming);else rememberAction(incoming.lastAction);
          state=incoming;localStorage.setItem(cacheKey(),JSON.stringify(state));render();
        }
      }else if(ev.kind===PRESENCE_KIND){
        const p=await decrypt(ev.content);if(p.deviceId)presence.set(p.deviceId,Date.now());updatePresence();
      }
    }catch{}
  };
  ws.onclose=()=>{updateConnection();const t=setTimeout(()=>connectRelay(url),2500+Math.random()*2500);reconnectTimers.set(url,t)};
  ws.onerror=()=>{try{ws.close()}catch{}};
}
function openSockets(){return[...sockets.values()].filter(x=>x.readyState===WebSocket.OPEN)}
function publishEvent(ev){openSockets().forEach(ws=>{try{ws.send(JSON.stringify(['EVENT',ev]))}catch{}})}
async function publishState(){if(!state)return;try{publishEvent(signed(STATE_KIND,await encrypt(state),[['client','stinkys-checklist']]));localStorage.setItem(cacheKey(),JSON.stringify(state))}catch{toast('Saved here — reconnecting')}}
async function sendPresence(){if(!aesKey)return;presence.set(deviceId,Date.now());try{publishEvent(signed(PRESENCE_KIND,await encrypt({deviceId,name:viewerName||'Another phone',at:Date.now()}),[['device',deviceId.slice(0,12)]]))}catch{}updatePresence()}
function updateConnection(){const n=openSockets().length;$('dot').classList.toggle('live',n>0);$('status').textContent=n>0?'Live and syncing':'Reconnecting…'}
function updatePresence(){const now=Date.now();presence.set(deviceId,now);for(const[id,t]of presence)if(now-t>35000)presence.delete(id);const n=Math.max(1,presence.size);$('phones').textContent=n===1?'1 phone':`${n} phones live`}

function mutate(fn,action=null,shouldRender=true){
  fn();const now=Date.now();
  state.updatedAt=now;state.updatedBy=viewerName||'A phone';state.updatedByDevice=deviceId;
  if(action)state.lastAction={id:crypto.randomUUID(),at:now,deviceId,actor:viewerName||state.name||'Stinky',...action};
  localStorage.setItem(cacheKey(),JSON.stringify(state));
  if(shouldRender)render();
  clearTimeout(publishTimer);publishTimer=setTimeout(publishState,100);
}
function enterApp(){
  localStorage.stinkyRecentRoom=roomCode;location.hash='r='+encodeURIComponent(normaliseCode(roomCode));
  $('welcome').classList.add('hidden');$('app').classList.remove('hidden');
  const cached=localStorage.getItem(cacheKey());hadCache=Boolean(cached);state=normaliseState(cached?JSON.parse(cached):blankState());
  render();connectAll();sendPresence();registerServiceWorker();updateAlertUI();
}
async function join(code){try{await setupRoom(code);enterApp()}catch{toast('That room code does not look right')}}

function renderDate(){
  const today=new Date();today.setHours(12,0,0,0);const diff=Math.round((selectedDate-today)/86400000);
  $('dateLabel').textContent=diff===0?'Today':diff===1?'Tomorrow':diff===-1?'Yesterday':selectedDate.toLocaleDateString('en-GB',{weekday:'long'});
  $('dateFull').textContent=selectedDate.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
}
function render(){
  if(!state)return;
  $('emoji').textContent=state.emoji||'🐶';$('title').textContent=`${state.name||'Stinky'}'s Checklist`;$('codeBtn').textContent=`Private code ${formatCode(roomCode)}`;
  renderDate();const d=getDay();let done=0;$('meals').innerHTML='';
  meals.forEach(m=>{
    const x=d[m.id];if(x.done)done++;
    const time=x.doneAt?new Date(x.doneAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'';
    const el=document.createElement('article');el.className=`meal-card ${x.done?'meal-done':''}`;
    el.innerHTML=`
      <div class="meal-head">
        <div class="meal-icon" style="background:${m.bg}">${m.icon}</div>
        <div class="meal-title"><h3>${m.name}</h3><small>${x.done?`${x.by?`Told by ${escape(x.by)}`:'Told the other phone'}${time?` at ${time}`:''}`:'Tap the big button after eating'}</small></div>
        <span class="meal-status">${x.done?'Eaten ✓':'Not yet'}</span>
      </div>
      <div class="meal-body">
        <label for="meal-${m.id}">What did you have? <span>(optional)</span></label>
        <textarea id="meal-${m.id}" class="meal-input" data-meal-input="${m.id}" rows="2" maxlength="160" placeholder="${escape(m.placeholder)}">${escape(x.text)}</textarea>
        <button type="button" class="meal-check ${x.done?'checked':''}" data-meal-check="${m.id}" aria-pressed="${x.done}">
          <span class="check-square">${x.done?'✓':m.icon}</span>
          <span class="check-copy"><strong>${x.done?`${m.name} eaten — tap to undo`:`I ate ${m.action}`}</strong><small>${x.done?'Charlie has been told':'One tap saves it and tells Charlie'}</small></span>
        </button>
      </div>`;
    $('meals').appendChild(el);
  });
  const pct=Math.round(done/4*100);$('ring').style.setProperty('--p',pct);$('percent').textContent=pct+'%';
  $('progressTitle').textContent=done===4?'Everything is checked!':`${done} of 4 checked`;
  $('progressSub').textContent=done===4?'Lovely — the whole day is done.':'Stinky can simply tap each big button after eating.';
  updateAlertUI();
}

function saveMealText(mealId,text){
  if(!state)return;const clean=text.trim();const x=getDay()[mealId];if(x.text===clean)return;
  mutate(()=>{x.text=clean;x.updatedAt=Date.now()},null,false);
}
function toggleMeal(mealId){
  if(!state)return;const meal=meals.find(m=>m.id===mealId);if(!meal)return;
  const d=getDay(),x=d[mealId],input=document.querySelector(`[data-meal-input="${mealId}"]`),text=(input?.value||x.text||'').trim();
  const wasDone=x.done,wasAll=allDone();
  mutate(()=>{x.text=text;x.done=!wasDone;x.by=!wasDone?(viewerName||state.name||'Stinky'):'';x.doneAt=!wasDone?Date.now():0;x.updatedAt=Date.now()},!wasDone?{type:'done',mealId,text}:null);
  if(navigator.vibrate)navigator.vibrate(!wasDone?[70,35,90]:40);
  if(!wasDone){publishReliableAlert(meal);toast(`Charlie has been told about ${meal.name.toLowerCase()} ✓`);if(!wasAll&&allDone())celebrate()}else toast(`${meal.name} unticked`);
}
function allDone(){const d=getDay();return meals.every(m=>d[m.id].done)}

async function publishReliableAlert(meal){
  if(!ntfyTopic)return;
  const name=state?.name||'Stinky';
  const appUrl=`${location.origin}${location.pathname}#r=${encodeURIComponent(normaliseCode(roomCode))}`;
  const params=new URLSearchParams({title:`${name}'s Checklist`,priority:'4',tags:'white_check_mark',click:appUrl});
  const url=`https://ntfy.sh/${encodeURIComponent(ntfyTopic)}?${params.toString()}`;
  try{await fetch(url,{method:'POST',mode:'no-cors',body:`${name} ate ${meal.action} ✓`})}catch{}
}
function rememberAction(action){if(action?.id)localStorage.setItem(seenKey(),action.id)}
function maybeAlert(incoming){
  const action=incoming.lastAction;if(!action?.id||action.deviceId===deviceId||action.type!=='done')return;
  if(localStorage.getItem(seenKey())===action.id)return;rememberAction(action);
  const meal=meals.find(m=>m.id===action.mealId);if(!meal)return;
  const name=incoming.name||'Stinky',body=action.text?`${meal.name}: ${action.text}`:`${meal.name} has been checked off.`;
  toast(`${name} ate ${meal.action} ✓`);if(navigator.vibrate)navigator.vibrate([80,40,120]);
  showDeviceNotification(`${name} ate ${meal.action} ✓`,body,action.id);
  if('setAppBadge'in navigator)navigator.setAppBadge(1).catch(()=>{});
}
async function registerServiceWorker(){if(!('serviceWorker'in navigator))return;try{swRegistration=await navigator.serviceWorker.register('./sw.js?v=4');await navigator.serviceWorker.ready}catch{}}
function isStandalone(){return window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true}
function isIOS(){return /iphone|ipad|ipod/i.test(navigator.userAgent)}
function isAndroid(){return /android/i.test(navigator.userAgent)}
async function requestAlerts(){
  if(isIOS()&&!isStandalone()){openInstallHelp();return}
  if(!('Notification'in window)||!('serviceWorker'in navigator)){toast('Use reliable alerts instead');openReliableAlerts();return}
  try{
    await registerServiceWorker();const permission=await Notification.requestPermission();
    if(permission==='granted'){
      localStorage.stinkyAlerts='on';updateAlertUI();
      await showDeviceNotification("Stinky's alerts are on",'This app will alert you while it can receive live updates.','stinky-test');
    }else toast('Notifications were not allowed');
  }catch{toast('Could not turn on app notifications')}
}
async function showDeviceNotification(title,body,tag){
  if(!alertsOn())return;
  try{const reg=swRegistration||await navigator.serviceWorker.ready;await reg.showNotification(title,{body,tag:'stinky-'+tag,icon:'./icon.svg',badge:'./icon.svg',data:{url:location.href}})}catch{}
}
function updateAlertUI(){
  if(!$('notifyBanner'))return;
  const ready=reliableSetup();$('notifyBanner').classList.toggle('hidden',ready);
  $('notificationsTitle').textContent=alertsOn()?'In-app notifications are on':'Enable in-app notifications';
  $('notificationsSub').textContent=alertsOn()?'Alerts arrive while the live app can receive updates':'Optional extra alerts while the app is active';
  $('reliableAlertsTitle').textContent=ready?'Reliable alerts set up':'Set up reliable alerts';
  $('reliableAlertsSub').textContent=ready?'Open your private alert channel':'Receive checks even when this checklist is closed';
}
function openReliableAlerts(){
  if(!ntfyTopic)return;
  $('alertTopic').textContent=ntfyTopic;show('reliableSheet');
}
async function copyAlertTopic(){
  try{await navigator.clipboard.writeText(ntfyTopic);localStorage.setItem(`stinkyReliable:${normaliseCode(roomCode)}`,'yes');updateAlertUI();toast('Private alert code copied')}catch{toast(ntfyTopic)}
}
function openAlertPage(){
  localStorage.setItem(`stinkyReliable:${normaliseCode(roomCode)}`,'yes');updateAlertUI();
  window.open(`https://ntfy.sh/${encodeURIComponent(ntfyTopic)}`,'_blank','noopener');
}
function openInstallHelp(){
  const android=isAndroid();
  $('installTitle').textContent=android?'Install on the Redmi':'Install Stinky\'s Checklist';
  $('installCopy').textContent=android?'Use Google Chrome so it appears as a proper app with its own icon.':'Add it to the Home Screen so it opens like a normal app.';
  $('installSteps').innerHTML=android?
    '<div><b>1</b><span>Open this private checklist link in <strong>Google Chrome</strong>.</span></div><div><b>2</b><span>Tap Chrome\'s <strong>⋮</strong> menu.</span></div><div><b>3</b><span>Tap <strong>Add to Home screen</strong>, then <strong>Install</strong>.</span></div>':
    '<div><b>1</b><span>Open this link in <strong>Safari</strong>.</span></div><div><b>2</b><span>Tap <strong>Share</strong>.</span></div><div><b>3</b><span>Tap <strong>Add to Home Screen</strong>.</span></div>';
  show('notifySheet');
}
async function installApp(){
  if(deferredInstallPrompt){deferredInstallPrompt.prompt();const result=await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;if(result.outcome==='accepted')toast('Stinky\'s Checklist installed');return}
  openInstallHelp();
}

function show(id){$(id).classList.remove('hidden')}
function hide(id){$(id).classList.add('hidden')}
function toast(s){const t=$('toast');t.textContent=s;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),2300)}
function celebrate(){const c=$('confetti');c.innerHTML='';for(let i=0;i<28;i++){const x=document.createElement('i');x.textContent=['♥','●','★','✦'][i%4];x.style.left=Math.random()*100+'vw';x.style.animationDelay=Math.random()*.35+'s';x.style.fontSize=12+Math.random()*18+'px';x.style.color=['#ff8e70','#ffd36c','#67ad7f','#9e86e8'][i%4];c.appendChild(x)}setTimeout(()=>c.innerHTML='',2100)}
async function share(){const url=location.origin+location.pathname+'#r='+encodeURIComponent(normaliseCode(roomCode));const text=`Open ${state.name||'Stinky'}'s live meal checklist:`;try{if(navigator.share)await navigator.share({title:"Stinky's Checklist",text,url});else{await navigator.clipboard.writeText(url);toast('Private link copied')}}catch(e){if(e.name!=='AbortError')toast('Could not share the link')}}

$('createBtn').addEventListener('click',()=>join(randomCode()));
$('joinForm').addEventListener('submit',e=>{e.preventDefault();join($('joinCode').value)});
$('leaveBtn').addEventListener('click',()=>{if(confirm('Leave this checklist on this phone?')){location.hash='';location.reload()}});
$('prev').addEventListener('click',()=>{selectedDate.setDate(selectedDate.getDate()-1);render()});
$('next').addEventListener('click',()=>{selectedDate.setDate(selectedDate.getDate()+1);render()});
$('dateMain').addEventListener('click',()=>{$('datePicker').value=dateKey();$('datePicker').showPicker?.()});
$('datePicker').addEventListener('change',()=>{const[y,m,d]=$('datePicker').value.split('-').map(Number);selectedDate=new Date(y,m-1,d,12);render()});
$('meals').addEventListener('click',event=>{const button=event.target.closest('[data-meal-check]');if(button)toggleMeal(button.dataset.mealCheck)});
$('meals').addEventListener('input',event=>{const input=event.target.closest('[data-meal-input]');if(!input)return;clearTimeout(inputTimers.get(input.dataset.mealInput));inputTimers.set(input.dataset.mealInput,setTimeout(()=>saveMealText(input.dataset.mealInput,input.value),400))});
$('meals').addEventListener('focusout',event=>{const input=event.target.closest('[data-meal-input]');if(input)saveMealText(input.dataset.mealInput,input.value)});
$('settingsBtn').addEventListener('click',()=>{$('listName').value=state.name||'Stinky';$('listEmoji').value=state.emoji||'🐶';$('myName').value=viewerName;show('settingsSheet')});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>hide(b.dataset.close)));
document.querySelectorAll('.sheet-backdrop').forEach(x=>x.addEventListener('click',e=>{if(e.target===x)hide(x.id)}));
$('settingsForm').addEventListener('submit',e=>{e.preventDefault();viewerName=$('myName').value.trim();localStorage.stinkyViewerName=viewerName;mutate(()=>{state.name=$('listName').value.trim()||'Stinky';state.emoji=$('listEmoji').value});hide('settingsSheet');sendPresence();toast('Saved for both phones')});
$('shareBtn').addEventListener('click',share);
$('codeBtn').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(formatCode(roomCode));toast('Private code copied')}catch{toast(formatCode(roomCode))}});
$('notificationsBtn').addEventListener('click',requestAlerts);
$('notifyBanner').addEventListener('click',openReliableAlerts);
$('reliableAlertsBtn').addEventListener('click',openReliableAlerts);
$('copyAlertBtn').addEventListener('click',copyAlertTopic);
$('openAlertBtn').addEventListener('click',openAlertPage);
$('installBtn').addEventListener('click',installApp);
$('nativeInstallBtn').addEventListener('click',installApp);
$('resetBtn').addEventListener('click',()=>{if(confirm('Clear all four answers for this day?'))mutate(()=>{const d=getDay();meals.forEach(m=>d[m.id]=blankMeal())})});

window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;toast('Installed — find it with your other apps')});
window.addEventListener('online',connectAll);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){connectAll();sendPresence();if('clearAppBadge'in navigator)navigator.clearAppBadge().catch(()=>{})}});
setInterval(sendPresence,12000);setInterval(updatePresence,5000);registerServiceWorker();
const fromHash=new URLSearchParams(location.hash.replace(/^#/,'')),code=fromHash.get('r'),recent=localStorage.stinkyRecentRoom;
if(recent){$('recentBtn').classList.remove('hidden');$('recentBtn').textContent='Open recent checklist '+formatCode(recent);$('recentBtn').onclick=()=>join(recent)}
if(code)join(code);else if(recent&&isStandalone())join(recent);
})();

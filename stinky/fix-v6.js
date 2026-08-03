(()=>{
  'use strict';

  const mealNames=['Breakfast','Lunch','Dinner','Snacks'];
  const meals=document.getElementById('meals');
  const ring=document.getElementById('ring');
  const percent=document.getElementById('percent');
  const progressTitle=document.getElementById('progressTitle');
  const progressSub=document.getElementById('progressSub');

  function isChecked(card){
    return card.classList.contains('meal-done')||Boolean(card.querySelector('.meal-check.checked,[data-meal-check][aria-pressed="true"]'));
  }

  function addStamp(card){
    let stamp=card.querySelector('.done-stamp-v6');
    if(!stamp){
      stamp=document.createElement('div');
      stamp.className='done-stamp-v6';
      stamp.setAttribute('aria-hidden','true');
      stamp.innerHTML='<span>✓</span><strong>CHECKED OFF</strong>';
      card.appendChild(stamp);
    }
  }

  function updateProgress(){
    if(!meals)return;
    const cards=[...meals.querySelectorAll('.meal-card')];
    let completed=0;

    cards.forEach(card=>{
      const checked=isChecked(card);
      card.classList.toggle('meal-done',checked);
      if(checked){completed++;addStamp(card)}
      else card.querySelector('.done-stamp-v6')?.remove();
    });

    const total=4;
    const value=Math.round((completed/total)*100);
    if(ring)ring.style.setProperty('--p',String(value));
    if(percent&&percent.textContent!==`${value}%`)percent.textContent=`${value}%`;
    if(progressTitle)progressTitle.textContent=completed===4?'Everything is checked!':`${completed} of 4 checked`;
    if(progressSub)progressSub.textContent=completed===4?'Lovely — the whole day is done.':'The ticks update here and on the other phone.';

    const progressCard=progressTitle?.closest('.progress-card');
    if(progressCard){
      let steps=progressCard.querySelector('.progress-steps-v6');
      if(!steps){
        steps=document.createElement('div');
        steps.className='progress-steps-v6';
        progressCard.appendChild(steps);
      }
      const states=cards.map(isChecked);
      while(states.length<4)states.push(false);
      const html=states.slice(0,4).map((checked,index)=>`<div class="${checked?'done':''}"><span>${checked?'✓':index+1}</span><small>${mealNames[index]}</small></div>`).join('');
      if(steps.innerHTML!==html)steps.innerHTML=html;
    }
  }

  if(meals){
    const observer=new MutationObserver(()=>requestAnimationFrame(updateProgress));
    observer.observe(meals,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-pressed']});
  }

  document.addEventListener('click',event=>{
    if(event.target.closest('[data-meal-check]')){
      updateProgress();
      setTimeout(updateProgress,80);
      setTimeout(updateProgress,350);
      setTimeout(updateProgress,1000);
    }
  });
  window.addEventListener('focus',updateProgress);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateProgress()});
  setInterval(updateProgress,1500);
  updateProgress();

  if('serviceWorker'in navigator){
    navigator.serviceWorker.register('./sw.js?v=6').then(registration=>registration.update()).catch(()=>{});
  }
})();

// Magic Names Sync - real-time session using Firebase Firestore
// Replace the configuration below with your Firebase project settings
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID"
};
if (typeof firebase !== 'undefined' && !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore ? firebase.firestore() : null;

let sessionCode = localStorage.getItem('magicSessionCode') || '';
let memberId = localStorage.getItem('magicMemberId') || '';
let memberName = localStorage.getItem('magicMemberName') || '';
let unsubscribeMembers = null;

function randomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function showCreateSession() {
  document.getElementById('session-setup').style.display = 'none';
  document.getElementById('create-panel').style.display = 'block';
}
function showJoinSession() {
  document.getElementById('session-setup').style.display = 'none';
  document.getElementById('join-panel').style.display = 'block';
}

function createSession() {
  const name = document.getElementById('create-name-input').value.trim();
  if (!name || !db) return;
  sessionCode = randomCode();
  memberId = Date.now().toString(36);
  memberName = name;
  localStorage.setItem('magicSessionCode', sessionCode);
  localStorage.setItem('magicMemberId', memberId);
  localStorage.setItem('magicMemberName', memberName);
  db.collection('sessions').doc(sessionCode).set({ created: Date.now() });
  db.collection('sessions').doc(sessionCode).collection('members').doc(memberId).set({ name });
  document.getElementById('created-code').textContent = sessionCode;
  document.getElementById('members').style.display = 'block';
  listenMembers();
}

function joinSession() {
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  const name = document.getElementById('join-name-input').value.trim();
  if (!code || !name || !db) return;
  sessionCode = code;
  memberId = Date.now().toString(36);
  memberName = name;
  localStorage.setItem('magicSessionCode', sessionCode);
  localStorage.setItem('magicMemberId', memberId);
  localStorage.setItem('magicMemberName', memberName);
  db.collection('sessions').doc(sessionCode).collection('members').doc(memberId).set({ name });
  document.getElementById('members').style.display = 'block';
  listenMembers();
}

function listenMembers() {
  if (!db || !sessionCode) return;
  if (unsubscribeMembers) unsubscribeMembers();
  unsubscribeMembers = db.collection('sessions').doc(sessionCode).collection('members')
    .onSnapshot(snap => {
      const div = document.getElementById('members');
      if (!div) return;
      div.innerHTML = '';
      snap.forEach(doc => {
        const span = document.createElement('span');
        span.style.marginRight = '0.5rem';
        span.textContent = doc.data().name;
        div.appendChild(span);
      });
    });
}

window.addEventListener('load', () => {
  if (sessionCode && db) {
    const div = document.getElementById('members');
    if (div) div.style.display = 'block';
    listenMembers();
  }
});

function announce(text) {
  if (!db || !sessionCode || !memberName) return;
  db.collection('sessions').doc(sessionCode).collection('updates').add({
    name: memberName,
    text,
    time: firebase.firestore.FieldValue.serverTimestamp()
  });
}

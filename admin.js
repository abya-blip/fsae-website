// ============================================================
// Applications dashboard — sign-in only. Uses the same team accounts as the
// public site (script.js). Firestore rules already restrict reads on the
// "applications" collection to signed-in users, so this page's gate is
// backed by real security, not just a UI check.
// ============================================================
import { auth, db } from "./firebase-init.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection, query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { animate, scroll } from "https://cdn.jsdelivr.net/npm/motion@13.1.1/+esm";

const applicationsRef = collection(db, "applications");

// ---------- motion.dev: scroll progress bar + tactile press feedback ----------
// same approach as the public site (script.js): filter, never transform,
// since Motion sets inline styles and would otherwise fight the existing
// CSS :hover{transform:...} rules on these same buttons.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if(!reducedMotion){
  scroll(animate(".scroll-progress", { scaleX: [0, 1] }, { ease: "linear" }));
}

function addPressFeedback(selector){
  if(reducedMotion) return;
  document.querySelectorAll(selector).forEach(el => {
    const press = () => animate(el, { filter: 'brightness(0.82)' }, { type: 'spring', stiffness: 600, damping: 30 });
    const release = () => animate(el, { filter: 'brightness(1)' }, { type: 'spring', stiffness: 300, damping: 20 });
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointerleave', release);
  });
}
addPressFeedback('.btn-primary');

const gate = document.getElementById('gate');
const dashboard = document.getElementById('dashboard');
const gateCard = document.getElementById('gateCard');
const gEmail = document.getElementById('gEmail');
const gPass = document.getElementById('gPass');
const gateMsg = document.getElementById('gateMsg');
const gateSignInBtn = document.getElementById('gateSignIn');
const adminAuthStatus = document.getElementById('adminAuthStatus');
const searchInput = document.getElementById('searchInput');
const filterVertical = document.getElementById('filterVertical');
const appCount = document.getElementById('appCount');
const appList = document.getElementById('appList');

let allApplications = [];
let unsubscribeApplications = null;

function fmtDate(ts){
  const d = ts && ts.toDate ? ts.toDate() : new Date(ts || Date.now());
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function renderApplications(){
  const search = searchInput.value.trim().toLowerCase();
  const vertical = filterVertical.value;

  const filtered = allApplications.filter(a => {
    const matchesSearch = !search
      || (a.name || '').toLowerCase().includes(search)
      || (a.email || '').toLowerCase().includes(search);
    const matchesVertical = !vertical || a.vertical === vertical;
    return matchesSearch && matchesVertical;
  });

  appCount.textContent = `${filtered.length} of ${allApplications.length} application${allApplications.length === 1 ? '' : 's'}`;

  if(filtered.length === 0){
    appList.innerHTML = `<div class="empty-state">${allApplications.length === 0 ? 'No applications yet.' : 'No applications match your search.'}</div>`;
    return;
  }

  appList.innerHTML = filtered.map(a => `
    <div class="app-card">
      <div class="app-head">
        <div class="app-name">${escapeHtml(a.name)}</div>
        ${a.vertical ? `<span class="app-vertical-tag">${escapeHtml(a.vertical)}</span>` : ''}
      </div>
      <div class="app-meta">
        <a href="mailto:${escapeHtml(a.email)}">${escapeHtml(a.email)}</a>
        <span>${escapeHtml(a.branch || '')}</span>
        <span>${escapeHtml(a.roll || '')}</span>
        <span class="app-date">${fmtDate(a.createdAt)}</span>
      </div>
      ${a.why ? `<div class="app-why">${escapeHtml(a.why)}</div>` : ''}
    </div>
  `).join('');
}

function subscribeToApplications(){
  if(unsubscribeApplications) return; // already listening
  appList.innerHTML = '<div class="empty-state"><span class="loader-dots"><span></span><span></span><span></span></span>Loading applications…</div>';
  try{
    const q = query(applicationsRef, orderBy('createdAt', 'desc'));
    unsubscribeApplications = onSnapshot(q, (snapshot) => {
      allApplications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderApplications();
    }, (err) => {
      console.error('Applications read error:', err);
      appList.innerHTML = `<div class="empty-state">Couldn't load applications (${err.code || err.message}).</div>`;
    });
  }catch(err){
    console.error(err);
    appList.innerHTML = `<div class="empty-state">Couldn't load applications (${err.code || err.message}).</div>`;
  }
}

function stopApplications(){
  if(unsubscribeApplications){ unsubscribeApplications(); unsubscribeApplications = null; }
  allApplications = [];
}

searchInput.addEventListener('input', renderApplications);
filterVertical.addEventListener('change', renderApplications);

// ---------- sign-in gate ----------
onAuthStateChanged(auth, (user) => {
  if(user){
    gate.style.display = 'none';
    dashboard.style.display = 'block';
    adminAuthStatus.innerHTML = `<span class="live-dot"></span>Signed in as ${escapeHtml(user.email)} · <button id="adminSignOut">Sign out</button>`;
    document.getElementById('adminSignOut').addEventListener('click', () => signOut(auth));
    subscribeToApplications();
  }else{
    dashboard.style.display = 'none';
    gate.style.display = 'flex';
    stopApplications();
    gEmail.value = '';
    gPass.value = '';
    gateMsg.textContent = '';
    gEmail.focus();
  }
});

gateSignInBtn.addEventListener('click', async () => {
  const email = gEmail.value.trim();
  const pass = gPass.value;
  if(!email || !pass){
    gateMsg.textContent = 'Enter both email and password.';
    gateMsg.className = 'form-msg err';
    return;
  }
  gateSignInBtn.disabled = true;
  gateMsg.textContent = 'Signing in…';
  gateMsg.className = 'form-msg';
  try{
    await signInWithEmailAndPassword(auth, email, pass);
    gateCard.classList.add('success-flash');
    setTimeout(() => gateCard.classList.remove('success-flash'), 650);
  }catch(err){
    gateMsg.textContent = `Sign-in failed (${err.code || err.message}).`;
    gateMsg.className = 'form-msg err';
    gateCard.classList.remove('shake');
    void gateCard.offsetWidth;
    gateCard.classList.add('shake');
  }finally{
    gateSignInBtn.disabled = false;
  }
});
gPass.addEventListener('keydown', (e) => { if(e.key === 'Enter') gateSignInBtn.click(); });

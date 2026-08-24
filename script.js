// ============================================================
// This is the public site's script. Firebase setup notes and the shared
// app/auth/db config live in firebase-init.js (also used by admin.js, the
// sign-in-only applications page) — edit the config there, not here.
// ============================================================
import { auth, db } from "./firebase-init.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection, addDoc, onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { animate, scroll, inView } from "https://cdn.jsdelivr.net/npm/motion@13.1.1/+esm";

const postsRef = collection(db, "posts");
const applicationsRef = collection(db, "applications");
const teamRef = collection(db, "team");
const announcementsRef = collection(db, "announcements");

// ---------- mobile menu ----------
const menuBtn = document.getElementById('menuBtn');
const navLinks = document.querySelector('.nav-links');
menuBtn.addEventListener('click', () => {
  const isOpen = navLinks.style.display === 'flex';
  navLinks.style.display = isOpen ? 'none' : 'flex';
  navLinks.style.flexDirection = 'column';
  navLinks.style.position = 'absolute';
  navLinks.style.top = '58px';
  navLinks.style.right = '24px';
  navLinks.style.background = '#121826';
  navLinks.style.border = '1px solid #223049';
  navLinks.style.padding = '16px 20px';
  navLinks.style.gap = '14px';
  navLinks.style.borderRadius = '12px';
});

// ---------- start-light hero sequence ----------
(function startLights(){
  const lights = document.querySelectorAll('.light');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduced){
    lights.forEach(l => l.classList.add('go'));
    return;
  }
  lights.forEach((l, i) => {
    setTimeout(() => l.classList.add('on'), 300 + i * 260);
  });
  setTimeout(() => {
    lights.forEach(l => { l.classList.remove('on'); l.classList.add('go'); });
  }, 300 + lights.length * 260 + 350);
  setTimeout(() => {
    lights.forEach(l => l.classList.remove('go'));
  }, 300 + lights.length * 260 + 1600);
})();

// ---------- scroll reveal ----------
const revealEls = document.querySelectorAll('.reveal');
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => { if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: 0.12 });
revealEls.forEach(el => io.observe(el));

// ---------- motion.dev: scroll progress bar, spring press feedback, count-up stats ----------
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if(!reducedMotion){
  scroll(animate(".scroll-progress", { scaleX: [0, 1] }, { ease: "linear" }));
}

// tactile press feedback via `filter`, never `transform` — the existing hover
// states on these same elements already animate `transform`, and Motion sets
// inline styles directly, so animating the same property here would fight them.
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
addPressFeedback('.btn-primary, .btn-ghost, .nav-cta, .join-apply');

// animates a stat element from one number to another; safe to call repeatedly
// as live data changes (e.g. the team roster growing)
function animateCount(el, from, to, duration = 1){
  if(!el) return;
  if(reducedMotion){ el.textContent = Math.round(to).toLocaleString(); return; }
  animate(from, to, {
    duration,
    ease: 'easeOut',
    onUpdate: (latest) => { el.textContent = Math.round(latest).toLocaleString(); }
  });
}

// ---------- countdown ----------
(function countdown(){
  const target = new Date('2027-06-01T00:00:00');
  const now = new Date();
  const days = Math.max(0, Math.ceil((target - now) / 86400000));
  const tickDaysEl = document.getElementById('tickDays');
  inView('.ticker', () => { animateCount(tickDaysEl, 0, days, 1.2); }, { amount: 0.4 });
})();

// ---------- blog: Firebase-backed ----------
const blogList = document.getElementById('blogList');
const modalBackdrop = document.getElementById('modalBackdrop');
const modalTitle = document.getElementById('modalTitle');
const signInStep = document.getElementById('signInStep');
const postStep = document.getElementById('postStep');
const teamStep = document.getElementById('teamStep');
const announceStep = document.getElementById('announceStep');
const emailInput = document.getElementById('emailInput');
const passInput = document.getElementById('passInput');
const signInMsg = document.getElementById('signInMsg');
const postMsg = document.getElementById('postMsg');
const authStatus = document.getElementById('authStatus');
const newPostBtn = document.getElementById('newPostBtn');

let currentUser = null;
let hasRenderedOnce = false;
let flashTopOnNextRender = false;
let pendingAction = 'post'; // 'post' | 'team' | 'announcement' — which step to reveal after sign-in
let pendingPostImage = null;
let pendingMemberPhoto = null;

function fmtDate(ts){
  const d = ts && ts.toDate ? ts.toDate() : new Date(ts || Date.now());
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---------- image handling: resize + compress client-side, store as base64 ----------
function resizeAndEncode(file, maxDim, quality){
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if(width > maxDim || height > maxDim){
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}

async function encodeImageForFirestore(file){
  let dataUrl = await resizeAndEncode(file, 900, 0.72);
  if(dataUrl.length > 900000) dataUrl = await resizeAndEncode(file, 700, 0.5);
  if(dataUrl.length > 900000) throw new Error('Image too large even after compression');
  return dataUrl;
}

// wires a file input to a live preview + returns the encoded data URL via onEncoded
function setupPhotoInput(inputEl, previewWrap, previewImg, removeBtn, msgEl, onEncoded){
  inputEl.addEventListener('change', async () => {
    const f = inputEl.files[0];
    if(!f) return;
    if(f.size > 10 * 1024 * 1024){
      if(msgEl){ msgEl.textContent = 'Image is too large — please pick one under 10MB.'; msgEl.className = 'form-msg err'; }
      inputEl.value = '';
      return;
    }
    if(msgEl){ msgEl.textContent = 'Processing image…'; msgEl.className = 'form-msg'; }
    try{
      const dataUrl = await encodeImageForFirestore(f);
      onEncoded(dataUrl);
      previewImg.src = dataUrl;
      previewWrap.style.display = 'flex';
      if(msgEl){ msgEl.textContent = ''; msgEl.className = 'form-msg'; }
    }catch(err){
      console.error(err);
      if(msgEl){ msgEl.textContent = 'Could not process that image — try a different one.'; msgEl.className = 'form-msg err'; }
      inputEl.value = '';
    }
  });
  removeBtn.addEventListener('click', () => {
    inputEl.value = '';
    previewWrap.style.display = 'none';
    onEncoded(null);
  });
}

setupPhotoInput(
  document.getElementById('pImage'), document.getElementById('pImagePreview'),
  document.getElementById('pImagePreviewImg'), document.getElementById('pImageRemove'),
  postMsg, (data) => { pendingPostImage = data; }
);
setupPhotoInput(
  document.getElementById('mPhoto'), document.getElementById('mPhotoPreview'),
  document.getElementById('mPhotoPreviewImg'), document.getElementById('mPhotoRemove'),
  document.getElementById('teamMsg'), (data) => { pendingMemberPhoto = data; }
);

function renderPosts(posts, flashTop){
  if(!posts || posts.length === 0){
    blogList.innerHTML = '<div class="empty-state">No posts yet. Be the first to log a build update.</div>';
    return;
  }
  blogList.innerHTML = posts.map(p => `
    <article class="post" data-id="${p.id}">
      ${p.image ? `<div class="post-image-wrap"><img class="post-image" src="${p.image}" alt="" loading="lazy"></div>` : ''}
      <div class="post-head">
        <div>
          <div class="post-meta"><span>${fmtDate(p.createdAt)}</span><span>·</span><span>${escapeHtml(p.author || 'Team')}</span>${p.tag ? `<span>·</span><span class="post-tag">${escapeHtml(p.tag)}</span>` : ''}</div>
          <div class="post-title">${escapeHtml(p.title)}</div>
        </div>
        <span class="chevron">▾</span>
      </div>
      <div class="post-body">${escapeHtml(p.body)}</div>
    </article>
  `).join('');

  blogList.querySelectorAll('.post').forEach(el => {
    el.addEventListener('click', () => el.classList.toggle('open'));
  });

  if(flashTop){
    const top = blogList.querySelector('.post');
    if(top) top.classList.add('post-new');
  }
}

// live-updating blog feed
function subscribeToPosts(){
  try{
    const q = query(postsRef, orderBy('createdAt', 'desc'));
    onSnapshot(q, (snapshot) => {
      const posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderPosts(posts, hasRenderedOnce && flashTopOnNextRender);
      hasRenderedOnce = true;
      flashTopOnNextRender = false;
    }, (err) => {
      console.error('Firestore read error:', err);
      blogList.innerHTML = '<div class="empty-state">Couldn\'t load posts — check the Firebase config in script.js.</div>';
    });
  }catch(err){
    console.error(err);
    blogList.innerHTML = '<div class="empty-state">Couldn\'t load posts — check the Firebase config in script.js.</div>';
  }
}
subscribeToPosts();

// ---------- team roster: Firebase-backed ----------
const teamGrid = document.getElementById('teamGrid');

function initials(name){
  return (name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0] ? w[0].toUpperCase() : '').join('') || '?';
}

function renderTeam(members){
  const tickMembers = document.getElementById('tickMembers');
  if(tickMembers){
    const prev = parseInt(tickMembers.dataset.val || '0', 10);
    const next = members ? members.length : 0;
    tickMembers.dataset.val = next;
    animateCount(tickMembers, prev, next, 0.8);
  }

  if(!members || members.length === 0){
    teamGrid.innerHTML = '<div class="empty-state">No team members yet — be the first to add yourself.</div>';
    return;
  }
  teamGrid.innerHTML = members.map(m => {
    // backward-compatible: older docs may only have a single `vertical` string
    const verticals = Array.isArray(m.verticals) ? m.verticals : (m.vertical ? [m.vertical] : []);
    return `
    <div class="team-card">
      <div class="team-avatar">${m.photo ? `<img src="${m.photo}" alt="${escapeHtml(m.name)}">` : escapeHtml(initials(m.name))}</div>
      <div class="team-name">${escapeHtml(m.name)}</div>
      ${m.role === 'Founder' ? '<span class="team-badge">Founder</span>' : ''}
      <div class="team-verticals">${verticals.map(v => `<span class="team-vertical-tag">${escapeHtml(v)}</span>`).join('')}</div>
      <div class="team-roll">${escapeHtml(m.rollNo || '')}</div>
    </div>
  `;
  }).join('');
}

function subscribeToTeam(){
  try{
    const q = query(teamRef, orderBy('createdAt', 'asc'));
    onSnapshot(q, (snapshot) => {
      const members = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      members.sort((a, b) => (a.role === 'Founder' ? 0 : 1) - (b.role === 'Founder' ? 0 : 1));
      renderTeam(members);
    }, (err) => {
      console.error('Team read error:', err);
      teamGrid.innerHTML = '<div class="empty-state">Couldn\'t load the team — check Firestore rules.</div>';
    });
  }catch(err){
    console.error(err);
    teamGrid.innerHTML = '<div class="empty-state">Couldn\'t load the team — check Firestore rules.</div>';
  }
}
subscribeToTeam();

// ---------- announcements: Firebase-backed, public read, sign-in required to post ----------
const announceList = document.getElementById('announceList');
const newAnnouncementBtn = document.getElementById('newAnnouncementBtn');
const navAnnounceAlert = document.getElementById('navAnnounceAlert');

function renderAnnouncements(items){
  if(!items || items.length === 0){
    announceList.innerHTML = '<div class="empty-state">No announcements yet.</div>';
    navAnnounceAlert.style.display = 'none';
    return;
  }
  announceList.innerHTML = items.map(a => `
    <div class="announce-card ${a.priority === 'urgent' ? 'urgent' : ''}">
      <div class="announce-head">
        <span class="announce-badge ${a.priority === 'urgent' ? 'urgent' : ''}">${a.priority === 'urgent' ? 'Urgent' : 'Notice'}</span>
        <span class="announce-date">${fmtDate(a.createdAt)}</span>
      </div>
      <div class="announce-title">${escapeHtml(a.title)}</div>
      <div class="announce-body">${escapeHtml(a.body)}</div>
      <div class="announce-author">— ${escapeHtml(a.author || 'Team')}</div>
    </div>
  `).join('');
  navAnnounceAlert.style.display = items.some(a => a.priority === 'urgent') ? 'inline-block' : 'none';
}

function subscribeToAnnouncements(){
  try{
    const q = query(announcementsRef, orderBy('createdAt', 'desc'));
    onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderAnnouncements(items);
    }, (err) => {
      console.error('Announcements read error:', err);
      announceList.innerHTML = `<div class="empty-state">Couldn't load announcements (${err.code || err.message}).</div>`;
    });
  }catch(err){
    console.error(err);
    announceList.innerHTML = `<div class="empty-state">Couldn't load announcements (${err.code || err.message}).</div>`;
  }
}
subscribeToAnnouncements();

// ---------- auth state ----------
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  authStatus.classList.add('fade-out');
  setTimeout(() => {
    if(user){
      authStatus.innerHTML = `<span class="live-dot"></span>Signed in as ${escapeHtml(user.email)} · <a href="admin.html">Applications</a> · <button id="signOutBtn">Sign out</button>`;
      document.getElementById('signOutBtn').addEventListener('click', () => signOut(auth));
    }else{
      authStatus.innerHTML = '';
    }
    authStatus.classList.remove('fade-out');
  }, 160);
});

// ---------- modal open/close ----------
// reveals the right step once we know the visitor is signed in
function showAuthedStep(){
  signInStep.style.display = 'none';
  postStep.style.display = 'none';
  teamStep.style.display = 'none';
  announceStep.style.display = 'none';
  if(pendingAction === 'team'){
    teamStep.style.display = 'block';
    modalTitle.textContent = 'Add Team Member';
    document.getElementById('mName').focus();
  }else if(pendingAction === 'announcement'){
    announceStep.style.display = 'block';
    modalTitle.textContent = 'Post Announcement';
    document.getElementById('anTitle').focus();
  }else{
    postStep.style.display = 'block';
    modalTitle.textContent = 'New Blog Post';
    document.getElementById('pTitle').focus();
  }
}

function openTeamOrPostModal(action){
  pendingAction = action;
  modalBackdrop.classList.add('show');
  if(currentUser){
    showAuthedStep();
  }else{
    modalTitle.textContent = 'Team Sign In';
    signInStep.style.display = 'block';
    postStep.style.display = 'none';
    teamStep.style.display = 'none';
    announceStep.style.display = 'none';
    emailInput.value = '';
    passInput.value = '';
    signInMsg.textContent = '';
    emailInput.focus();
  }
}

newPostBtn.addEventListener('click', () => openTeamOrPostModal('post'));
const addTeamBtn = document.getElementById('addTeamBtn');
if(addTeamBtn) addTeamBtn.addEventListener('click', () => openTeamOrPostModal('team'));
newAnnouncementBtn.addEventListener('click', () => openTeamOrPostModal('announcement'));

function closeModal(){ modalBackdrop.classList.remove('show'); }
document.getElementById('cancelSignIn').addEventListener('click', closeModal);
document.getElementById('cancelPost').addEventListener('click', closeModal);
document.getElementById('cancelTeam').addEventListener('click', closeModal);
document.getElementById('cancelAnnounce').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (e) => { if(e.target === modalBackdrop) closeModal(); });

// ---------- sign in ----------
document.getElementById('doSignIn').addEventListener('click', async () => {
  const email = emailInput.value.trim();
  const pass = passInput.value;
  if(!email || !pass){
    signInMsg.textContent = 'Enter both email and password.';
    return;
  }
  const btn = document.getElementById('doSignIn');
  btn.disabled = true;
  signInMsg.textContent = 'Signing in…';
  signInMsg.className = 'form-msg';
  try{
    await signInWithEmailAndPassword(auth, email, pass);
    const modalEl = modalBackdrop.querySelector('.modal');
    modalEl.classList.add('success-flash');
    setTimeout(() => modalEl.classList.remove('success-flash'), 650);
    showAuthedStep();
  }catch(err){
    signInMsg.textContent = 'Sign-in failed — check the email/password, or ask a lead to create your account.';
    signInMsg.className = 'form-msg err';
    const modalEl = modalBackdrop.querySelector('.modal');
    modalEl.classList.remove('shake');
    void modalEl.offsetWidth;
    modalEl.classList.add('shake');
  }finally{
    btn.disabled = false;
  }
});
passInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') document.getElementById('doSignIn').click(); });

// ---------- publish post ----------
document.getElementById('publishPost').addEventListener('click', async () => {
  const title = document.getElementById('pTitle').value.trim();
  const author = document.getElementById('pAuthor').value.trim();
  const tag = document.getElementById('pTag').value.trim();
  const body = document.getElementById('pBody').value.trim();

  if(!title || !body){
    postMsg.textContent = 'Title and post body are required.';
    postMsg.className = 'form-msg err';
    return;
  }
  if(!currentUser){
    postMsg.textContent = 'You were signed out — please sign in again.';
    postMsg.className = 'form-msg err';
    return;
  }

  const btn = document.getElementById('publishPost');
  btn.disabled = true;
  postMsg.textContent = 'Publishing…';
  postMsg.className = 'form-msg';

  try{
    await addDoc(postsRef, {
      title, author, tag, body,
      image: pendingPostImage || null,
      createdAt: serverTimestamp(),
      authorUid: currentUser.uid
    });
    flashTopOnNextRender = true;
    postMsg.textContent = 'Published!';
    postMsg.className = 'form-msg ok';
    setTimeout(() => {
      closeModal();
      document.getElementById('pTitle').value = '';
      document.getElementById('pAuthor').value = '';
      document.getElementById('pTag').value = '';
      document.getElementById('pBody').value = '';
      document.getElementById('pImage').value = '';
      document.getElementById('pImagePreview').style.display = 'none';
      pendingPostImage = null;
      postMsg.textContent = '';
    }, 700);
  }catch(err){
    console.error(err);
    postMsg.textContent = `Something went wrong publishing (${err.code || err.message}).`;
    postMsg.className = 'form-msg err';
  }finally{
    btn.disabled = false;
  }
});

// ---------- add team member ----------
const mName = document.getElementById('mName');
const mRoll = document.getElementById('mRoll');
const mVertical = document.getElementById('mVertical');
const mVerticalSingleWrap = document.getElementById('mVerticalSingleWrap');
const mVerticalMultiWrap = document.getElementById('mVerticalMultiWrap');
const mVerticalMultiBoxes = document.querySelectorAll('#mVerticalMulti input[type="checkbox"]');
const mRole = document.getElementById('mRole');
const teamMsg = document.getElementById('teamMsg');
const submitTeamBtn = document.getElementById('submitTeam');

// Founders can pick multiple verticals; everyone else picks one.
function updateVerticalPickerForRole(){
  if(mRole.value === 'Founder'){
    mVerticalSingleWrap.style.display = 'none';
    mVerticalMultiWrap.style.display = 'block';
    mVertical.value = '';
  }else{
    mVerticalMultiWrap.style.display = 'none';
    mVerticalSingleWrap.style.display = 'block';
    mVerticalMultiBoxes.forEach(cb => { cb.checked = false; });
  }
}
mRole.addEventListener('change', updateVerticalPickerForRole);
updateVerticalPickerForRole();

submitTeamBtn.addEventListener('click', async () => {
  const name = mName.value.trim();
  const rollNo = mRoll.value.trim();
  const role = mRole.value;
  const verticals = role === 'Founder'
    ? Array.from(mVerticalMultiBoxes).filter(cb => cb.checked).map(cb => cb.value)
    : (mVertical.value ? [mVertical.value] : []);

  if(!name || !rollNo || verticals.length === 0){
    teamMsg.textContent = role === 'Founder'
      ? 'Please fill in name, roll number, and pick at least one vertical.'
      : 'Please fill in name, roll number, and vertical.';
    teamMsg.className = 'form-msg err';
    return;
  }
  if(!currentUser){
    teamMsg.textContent = 'You were signed out — please sign in again.';
    teamMsg.className = 'form-msg err';
    return;
  }

  submitTeamBtn.disabled = true;
  teamMsg.textContent = 'Adding…';
  teamMsg.className = 'form-msg';

  try{
    await addDoc(teamRef, {
      name, rollNo, verticals, role,
      photo: pendingMemberPhoto || null,
      createdAt: serverTimestamp(),
      addedByUid: currentUser.uid
    });
    teamMsg.textContent = 'Added to the roster!';
    teamMsg.className = 'form-msg ok';
    setTimeout(() => {
      closeModal();
      mName.value = ''; mRoll.value = ''; mVertical.value = ''; mRole.value = 'Member';
      updateVerticalPickerForRole();
      document.getElementById('mPhoto').value = '';
      document.getElementById('mPhotoPreview').style.display = 'none';
      pendingMemberPhoto = null;
      teamMsg.textContent = '';
    }, 900);
  }catch(err){
    console.error(err);
    teamMsg.textContent = `Something went wrong (${err.code || err.message}). Check that the "team" rule is published in Firestore.`;
    teamMsg.className = 'form-msg err';
    const modalEl = modalBackdrop.querySelector('.modal');
    modalEl.classList.remove('shake');
    void modalEl.offsetWidth;
    modalEl.classList.add('shake');
  }finally{
    submitTeamBtn.disabled = false;
  }
});

// ---------- post announcement ----------
document.getElementById('publishAnnounce').addEventListener('click', async () => {
  const anTitle = document.getElementById('anTitle');
  const anPriority = document.getElementById('anPriority');
  const anBody = document.getElementById('anBody');
  const announceMsg = document.getElementById('announceMsg');

  const title = anTitle.value.trim();
  const priority = anPriority.value;
  const body = anBody.value.trim();

  if(!title || !body){
    announceMsg.textContent = 'Title and message are required.';
    announceMsg.className = 'form-msg err';
    return;
  }
  if(!currentUser){
    announceMsg.textContent = 'You were signed out — please sign in again.';
    announceMsg.className = 'form-msg err';
    return;
  }

  const btn = document.getElementById('publishAnnounce');
  btn.disabled = true;
  announceMsg.textContent = 'Posting…';
  announceMsg.className = 'form-msg';

  try{
    await addDoc(announcementsRef, {
      title, priority, body,
      author: currentUser.email,
      authorUid: currentUser.uid,
      createdAt: serverTimestamp()
    });
    announceMsg.textContent = 'Posted!';
    announceMsg.className = 'form-msg ok';
    setTimeout(() => {
      closeModal();
      anTitle.value = ''; anPriority.value = 'normal'; anBody.value = '';
      announceMsg.textContent = '';
    }, 700);
  }catch(err){
    console.error(err);
    announceMsg.textContent = `Something went wrong posting (${err.code || err.message}).`;
    announceMsg.className = 'form-msg err';
    const modalEl = modalBackdrop.querySelector('.modal');
    modalEl.classList.remove('shake');
    void modalEl.offsetWidth;
    modalEl.classList.add('shake');
  }finally{
    btn.disabled = false;
  }
});

// ---------- join application: Firestore-backed ----------
const applyModalBackdrop = document.getElementById('applyModalBackdrop');
const aName = document.getElementById('aName');
const aEmail = document.getElementById('aEmail');
const aBranch = document.getElementById('aBranch');
const aRoll = document.getElementById('aRoll');
const aVertical = document.getElementById('aVertical');
const aWhy = document.getElementById('aWhy');
const applyMsg = document.getElementById('applyMsg');
const submitApplyBtn = document.getElementById('submitApply');

function openApplyModal(prefillVertical){
  aName.value = ''; aEmail.value = ''; aBranch.value = ''; aRoll.value = ''; aWhy.value = '';
  aVertical.value = prefillVertical || '';
  applyMsg.textContent = '';
  applyMsg.className = 'form-msg';
  applyModalBackdrop.classList.add('show');
  aName.focus();
}
function closeApplyModal(){ applyModalBackdrop.classList.remove('show'); }

// nav + hero "Join The Team" buttons open the application form directly
[document.getElementById('navJoinBtn'), document.getElementById('heroJoinBtn')].forEach(btn => {
  if(!btn) return;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    openApplyModal();
  });
});

// "Apply Now" in the join section header
const applyNowBtn = document.getElementById('applyNowBtn');
if(applyNowBtn) applyNowBtn.addEventListener('click', () => openApplyModal());

// per sub-team "Apply →" buttons, prefilled with that vertical
document.querySelectorAll('.join-apply').forEach(btn => {
  btn.addEventListener('click', () => openApplyModal(btn.dataset.vertical));
});

document.getElementById('cancelApply').addEventListener('click', closeApplyModal);
applyModalBackdrop.addEventListener('click', (e) => { if(e.target === applyModalBackdrop) closeApplyModal(); });

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

submitApplyBtn.addEventListener('click', async () => {
  const name = aName.value.trim();
  const email = aEmail.value.trim();
  const branch = aBranch.value.trim();
  const roll = aRoll.value.trim();
  const vertical = aVertical.value;
  const why = aWhy.value.trim();

  if(!name || !email || !branch || !roll || !vertical){
    applyMsg.textContent = 'Please fill in name, email, branch, roll number, and a vertical.';
    applyMsg.className = 'form-msg err';
    return;
  }
  if(!emailPattern.test(email)){
    applyMsg.textContent = 'That email address doesn\'t look right.';
    applyMsg.className = 'form-msg err';
    return;
  }

  submitApplyBtn.disabled = true;
  applyMsg.textContent = 'Submitting…';
  applyMsg.className = 'form-msg';

  try{
    await addDoc(applicationsRef, {
      name, email, branch, roll, vertical, why,
      createdAt: serverTimestamp()
    });
    applyMsg.textContent = 'Application received — we\'ll be in touch!';
    applyMsg.className = 'form-msg ok';
    setTimeout(() => {
      closeApplyModal();
      applyMsg.textContent = '';
    }, 1100);
  }catch(err){
    console.error(err);
    applyMsg.textContent = `Something went wrong submitting (${err.code || err.message}) — please try again.`;
    applyMsg.className = 'form-msg err';
    const modalEl = applyModalBackdrop.querySelector('.modal');
    modalEl.classList.remove('shake');
    void modalEl.offsetWidth;
    modalEl.classList.add('shake');
  }finally{
    submitApplyBtn.disabled = false;
  }
});
aWhy.addEventListener('keydown', (e) => { if(e.key === 'Enter' && e.ctrlKey) submitApplyBtn.click(); });

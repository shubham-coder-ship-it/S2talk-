(function(){
"use strict";

/* pdf.js worker — set once, matched to the loaded library version, so
   text extraction doesn't fall back to the slower "fake worker" path. */
if(window.pdfjsLib){
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
}
/* pdf.js logs a harmless "glyf table not found -- trying to recover" warning
   for some PDFs with subsetted fonts; it doesn't affect text extraction, so
   it's filtered out here to keep the console clean without hiding real errors. */
const _origConsoleWarn = console.warn.bind(console);
console.warn = (...args)=>{
  const msg = args.map(a=>String(a)).join(' ');
  if(msg.includes('glyf') || msg.includes('fake worker')) return;
  _origConsoleWarn(...args);
};

/* ============================================================
   APP / USER STATE (in-memory only — resets on page reload)
   ============================================================ */
const AppState = {
  users: {},           // email -> user record (this-session "database")
  current: null,       // logged-in user object
  friends: [],          // added contacts
  projects: [],          // saved code projects
  interview: { history: [], scores: [] },
  quiz: { completed: {}, streak: 0 },
  chat: {},             // per-friend message log
  loginTime: null,
  avatarEmoji: '🙂',
  carColor: '#5B4FE8',
  notifications: true,  // Settings toggle: on/off
  controlsEnabled: true, // Settings toggle: show/hide the mobile virtual controller
  notifLog: [],          // Notification House feed
  notifUnread: 0,
  sfxOn: true,
  musicOn: true,
  volume: 0.5,
  xp: 0,
  coins: 0,
  level: 1,
  missions: {
    visit3: {label:'Visit 3 different buildings', target:3, progress:0, reward:20, claimed:false},
    interview1: {label:'Answer 1 interview question', target:1, progress:0, reward:25, claimed:false},
    quiz1: {label:'Complete 1 skills quiz', target:1, progress:0, reward:20, claimed:false},
    code1: {label:'Run code in the Projects Lab', target:1, progress:0, reward:15, claimed:false},
    game1: {label:'Play a mini-game in Play House', target:1, progress:0, reward:15, claimed:false},
  },
};
function progressMission(key, amount){
  const m = AppState.missions[key];
  if(!m || m.claimed) return;
  m.progress = Math.min(m.target, m.progress + (amount||1));
}
function addXP(n){
  AppState.xp += n;
  addCoins(Math.round(n*0.6), 'other');
  const newLevel = Math.floor(AppState.xp/100)+1;
  if(newLevel > AppState.level){
    AppState.level = newLevel;
    addCoins(100, 'level'); // Level & Coin System — every Level Up rewards +100 coins
    toast(`⭐ Level up! You're now level ${AppState.level}. +100 coins!`);
    pushNotification(`⭐ Level up! You're now level ${AppState.level}. +100 coins!`);
    Audio_.blip(880);
  }
  const badge = document.getElementById('xp-badge');
  if(badge) badge.textContent = `⭐ Lv.${AppState.level} · ${AppState.xp} XP · 🪙${AppState.coins}`;
}
const DIRECTORY = [
  {name:'Aarav Mehta', id:'S2-AA1029', skills:['React','Node.js'], online:true},
  {name:'Priya Nair', id:'S2-PN2284', skills:['Python','ML'], online:false},
  {name:'Daniel Osei', id:'S2-DO5571', skills:['Java','DSA'], online:true},
  {name:'Wei Zhang', id:'S2-WZ8843', skills:['Cloud','DevOps'], online:false},
  {name:'Sofia Rossi', id:'S2-SR3390', skills:['UI Design','Figma'], online:true},
];

function genUID(){
  return 'S2-' + Math.random().toString(36).slice(2,5).toUpperCase() + Math.floor(1000+Math.random()*9000);
}

/* ============================================================
   SCREEN NAV
   ============================================================ */
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
document.getElementById('go-signup').addEventListener('click', ()=>showScreen('signup'));
document.getElementById('go-login').addEventListener('click', ()=>showScreen('login'));
document.getElementById('su-to-login').addEventListener('click', ()=>showScreen('login'));
document.getElementById('li-to-signup').addEventListener('click', ()=>showScreen('signup'));
document.getElementById('li-to-forgot').addEventListener('click', ()=>{ resetForgotFlow(); showScreen('forgot'); });
document.getElementById('fp-back-to-login').addEventListener('click', ()=>{ resetForgotFlow(); showScreen('login'); });

/* ---- signup avatar preview ---- */
document.getElementById('su-pic').addEventListener('change', function(e){
  const f = e.target.files[0];
  if(!f) return;
  const reader = new FileReader();
  reader.onload = ev=>{
    document.getElementById('signup-avatar-preview').innerHTML = `<img src="${ev.target.result}">`;
    AppState._pendingPic = ev.target.result;
  };
  reader.readAsDataURL(f);
});

/* ---- signup resume extraction (real, client-side + server fallback) ---- */
if(window['pdfjsLib']) {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  } catch(e){}
}

document.getElementById('su-resume').addEventListener('change', async function(e){
  const f = e.target.files[0];
  const statusEl = document.getElementById('su-resume-status');
  if(!f) return;
  statusEl.textContent = '⚡ Reading & extracting resume PDF...';
  try{
    let text = '';
    if(f.type==='application/pdf' || f.name.toLowerCase().endsWith('.pdf')){
      if(window['pdfjsLib']){
        try {
          const buf = await f.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({data:buf}).promise;
          for(let p=1;p<=Math.min(pdf.numPages,8);p++){
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            text += content.items.map(it=>it.str).join(' ') + '\n';
          }
        } catch(pdfErr){
          /* pdfjs in-browser parse failed; fallback to backend upload */
        }
      }
    } else if(f.name.toLowerCase().endsWith('.docx')){
      if(window['mammoth']){
        const buf = await f.arrayBuffer();
        const result = await mammoth.extractRawText({arrayBuffer:buf});
        text = result.value;
      }
    }

    text = text.trim().replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').slice(0, 10000);
    
    let parsed = null;
    if(text){
      statusEl.textContent = '🧠 Analyzing resume content — generating bio & skills summary...';
      try{
        const res = await fetch('/api/parse-resume', {
          method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({text})
        });
        if(res.ok) parsed = await res.json();
      }catch(err){}
    }

    // Backend fallback if client extraction yielded no result
    if(!parsed || !parsed.summary){
      try{
        statusEl.textContent = '🧠 Processing resume file on server...';
        const formData = new FormData();
        formData.append('file', f);
        const res = await fetch('/api/parse-resume', { method:'POST', body: formData });
        if(res.ok) parsed = await res.json();
      }catch(err){}
    }

    if(parsed && (parsed.summary || parsed.skills)){
      if(parsed.summary) document.getElementById('su-bio').value = parsed.summary;
      const skillsEl = document.getElementById('su-skills');
      if(!skillsEl.value.trim() && parsed.skills) skillsEl.value = parsed.skills;
      statusEl.textContent = `✅ Auto-filled summary and skills from ${f.name} — feel free to edit any detail below!`;
    } else {
      statusEl.textContent = `Attached ${f.name} — you can edit your bio and skills below before saving.`;
    }
  }catch(err){
    statusEl.textContent = 'File attached — please feel free to customize your bio & skills below.';
  }
});


/* ---- signup submit (real backend) ---- */
document.getElementById('su-submit').addEventListener('click', async ()=>{
  const name = document.getElementById('su-name').value.trim();
  const email = document.getElementById('su-email').value.trim().toLowerCase();
  const pass = document.getElementById('su-pass').value;
  const skills = document.getElementById('su-skills').value.trim();
  const bio = document.getElementById('su-bio').value.trim();
  const city = document.getElementById('su-city').value.trim();
  const resumeFile = document.getElementById('su-resume').files[0];
  const picFile = document.getElementById('su-pic').files[0];
  const errEl = document.getElementById('su-err');
  const btn = document.getElementById('su-submit');
  if(!name || !email || pass.length<6){
    errEl.textContent = 'Please enter a name, valid email, and a password of at least 6 characters.';
    errEl.style.display='block'; return;
  }
  errEl.style.display='none';
  const fd = new FormData();
  fd.append('name', name); fd.append('email', email); fd.append('password', pass);
  fd.append('skills', skills); fd.append('bio', bio); fd.append('city', city);
  if(resumeFile) fd.append('resume', resumeFile);
  if(picFile) fd.append('avatar', picFile);
  btn.disabled = true; btn.textContent = 'Creating account...';
  try{
    const res = await fetch('/api/register', {method:'POST', body: fd});
    const data = await res.json();
    if(!res.ok){
      errEl.textContent = data.error || 'Could not create account.';
      errEl.style.display='block'; return;
    }
    loginAs(data.user);
  }catch(err){
    errEl.textContent = 'Network error — is the server running? (python app.py)';
    errEl.style.display='block';
  }finally{
    btn.disabled = false; btn.textContent = 'Create Account';
  }
});

document.getElementById('li-submit').addEventListener('click', async ()=>{
  const email = document.getElementById('li-email').value.trim().toLowerCase();
  const pass = document.getElementById('li-pass').value;
  const errEl = document.getElementById('li-err');
  const btn = document.getElementById('li-submit');
  errEl.style.display='none';
  btn.disabled = true; btn.textContent = 'Logging in...';
  try{
    const res = await fetch('/api/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({email, password: pass})
    });
    const data = await res.json();
    if(!res.ok){
      errEl.textContent = data.error || 'Login failed.';
      errEl.style.display='block'; return;
    }
    loginAs(data.user);
  }catch(err){
    errEl.textContent = 'Network error — is the server running? (python app.py)';
    errEl.style.display='block';
  }finally{
    btn.disabled = false; btn.textContent = 'Login';
  }
});

/* ---- forgot password / OTP recovery flow ---- */
let fpEmail=null, fpResetToken=null, fpTimerInterval=null, fpExpiresAt=null;
function resetForgotFlow(){
  fpEmail=null; fpResetToken=null; clearInterval(fpTimerInterval);
  document.getElementById('fp-step-email').style.display='block';
  document.getElementById('fp-step-otp').style.display='none';
  document.getElementById('fp-step-reset').style.display='none';
  ['fp-email','fp-otp','fp-new-pass','fp-confirm-pass'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  ['fp-email-err','fp-otp-err','fp-reset-err'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });
}
function startOtpTimer(seconds){
  clearInterval(fpTimerInterval);
  fpExpiresAt = Date.now() + seconds*1000;
  const timerEl = document.getElementById('fp-timer');
  fpTimerInterval = setInterval(()=>{
    const remaining = Math.max(0, Math.round((fpExpiresAt-Date.now())/1000));
    const m=Math.floor(remaining/60), s=remaining%60;
    if(timerEl) timerEl.textContent = remaining>0 ? `Code expires in ${m}:${String(s).padStart(2,'0')}` : 'Code expired — please resend.';
    if(remaining<=0) clearInterval(fpTimerInterval);
  }, 1000);
}
document.getElementById('fp-send-otp').addEventListener('click', async ()=>{
  const email = document.getElementById('fp-email').value.trim().toLowerCase();
  const errEl = document.getElementById('fp-email-err');
  const btn = document.getElementById('fp-send-otp');
  if(!email || !email.includes('@')){ errEl.textContent='Please enter a valid email.'; errEl.style.display='block'; return; }
  errEl.style.display='none'; btn.disabled=true; btn.textContent='Sending...';
  try{
    const res = await fetch('/api/forgot-password', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email})});
    const data = await res.json();
    fpEmail = email;
    document.getElementById('fp-email-echo').textContent = email;
    document.getElementById('fp-step-email').style.display='none';
    document.getElementById('fp-step-otp').style.display='block';
    startOtpTimer(data.expires_in_seconds || 600);
    if(data.dev_otp) toast('🧪 Dev mode — OTP is '+data.dev_otp+' (no email service configured)');
    else toast('📧 OTP sent — check your email.');
  }catch(e){ errEl.textContent='Network error — is the server running?'; errEl.style.display='block'; }
  btn.disabled=false; btn.textContent='Send OTP';
});
document.getElementById('fp-resend-otp').addEventListener('click', ()=>{ document.getElementById('fp-send-otp').click(); document.getElementById('fp-step-email').style.display='none'; document.getElementById('fp-step-otp').style.display='block'; });
document.getElementById('fp-verify-otp').addEventListener('click', async ()=>{
  const otp = document.getElementById('fp-otp').value.trim();
  const errEl = document.getElementById('fp-otp-err');
  const btn = document.getElementById('fp-verify-otp');
  if(!/^\d{6}$/.test(otp)){ errEl.textContent='Enter the 6-digit code.'; errEl.style.display='block'; return; }
  errEl.style.display='none'; btn.disabled=true; btn.textContent='Verifying...';
  try{
    const res = await fetch('/api/verify-otp', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:fpEmail, otp})});
    const data = await res.json();
    if(!res.ok){ errEl.textContent=data.error||'Invalid OTP.'; errEl.style.display='block'; btn.disabled=false; btn.textContent='Verify Code'; return; }
    fpResetToken = data.reset_token;
    clearInterval(fpTimerInterval);
    document.getElementById('fp-step-otp').style.display='none';
    document.getElementById('fp-step-reset').style.display='block';
  }catch(e){ errEl.textContent='Network error — is the server running?'; errEl.style.display='block'; }
  btn.disabled=false; btn.textContent='Verify Code';
});
document.getElementById('fp-reset-submit').addEventListener('click', async ()=>{
  const p1 = document.getElementById('fp-new-pass').value;
  const p2 = document.getElementById('fp-confirm-pass').value;
  const errEl = document.getElementById('fp-reset-err');
  const btn = document.getElementById('fp-reset-submit');
  if(p1.length<6){ errEl.textContent='Password must be at least 6 characters.'; errEl.style.display='block'; return; }
  if(p1!==p2){ errEl.textContent='Passwords do not match.'; errEl.style.display='block'; return; }
  errEl.style.display='none'; btn.disabled=true; btn.textContent='Resetting...';
  try{
    const res = await fetch('/api/reset-password', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:fpEmail, reset_token:fpResetToken, new_password:p1})});
    const data = await res.json();
    if(!res.ok){ errEl.textContent=data.error||'Could not reset password.'; errEl.style.display='block'; btn.disabled=false; btn.textContent='Reset Password & Login'; return; }
    toast('✅ Password reset — logging you in...');
    const loginRes = await fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:fpEmail, password:p1})});
    const loginData = await loginRes.json();
    if(loginRes.ok){ resetForgotFlow(); loginAs(loginData.user); }
    else { resetForgotFlow(); showScreen('login'); }
  }catch(e){ errEl.textContent='Network error — is the server running?'; errEl.style.display='block'; }
  btn.disabled=false; btn.textContent='Reset Password & Login';
});

function saveUserData(){
  const u = AppState.current;
  if(!u) return;
  try{
    const data = {
      xp: AppState.xp,
      coins: AppState.coins,
      level: AppState.level,
      coinsEarned: AppState.coinsEarned || 0,
      coinsSpent: AppState.coinsSpent || 0,
      coinsBySource: AppState.coinsBySource || {level:0, game:0, mission:0, other:0},
      projects: AppState.projects || [],
      interview: AppState.interview || { history: [], scores: [] },
      quiz: AppState.quiz || { completed: {}, streak: 0 },
      recordings: (AppState.recordings || []).map(r => ({ id: r.id, name: r.name, url: r.url, size: r.size })),
      photos: AppState.photos || [],
      files: AppState.files || [],
      receivedMedia: AppState.receivedMedia || [],
      notifLog: AppState.notifLog || [],
      notifUnread: AppState.notifUnread || 0,
      notifications: AppState.notifications !== undefined ? AppState.notifications : true,
      controlsEnabled: AppState.controlsEnabled !== undefined ? AppState.controlsEnabled : true,
      missions: AppState.missions || {},
      unlocked: Array.from(unlocked || []),
      resultsViewModes: AppState.resultsViewModes || { interviews: 'list', skills: 'list', recordings: 'list', photos: 'large', projects: 'list' },
      activeBuilding: currentBuilding ? currentBuilding.id : null,
      currentModalView: currentModalView || null,
      activeTabs: { resultsTab, contactsTab, mediaTab, playTab },
      labState: { labLang, labCodeDraft, labTerminalSessionOutput, labStdinDraft },
      activeFriendUid: activeFriendUid || null,
      pinnedFriends: Array.from(pinnedFriends || []),
      aiSessions: aiSessions || [],
      aiCurrentSessionId: aiCurrentSessionId || null,
      aiHistory: aiHistory || []
    };
    localStorage.setItem('s2talk_userdata_' + u.uid, JSON.stringify(data));
  }catch(e){
    console.error('Failed to save user data:', e);
  }
}

let _saveUserDataDebounceTimer = null;
function saveUserDataDebounced(delay){
  clearTimeout(_saveUserDataDebounceTimer);
  _saveUserDataDebounceTimer = setTimeout(saveUserData, delay || 500);
}

function clearLocalUserData(uid){
  if(!uid) return;
  try{
    localStorage.removeItem('s2talk_userdata_' + uid);
    localStorage.removeItem('s2talk_pinned_friends_' + uid);
    localStorage.removeItem('s2talk_lab_active_lang_' + uid);
    Object.keys(typeof STARTER_CODE!=='undefined' ? STARTER_CODE : {}).forEach(lang=>{
      localStorage.removeItem('s2talk_lab_draft_' + uid + '_' + lang);
    });
  }catch(e){}
}

function loadUserData(){
  const u = AppState.current;
  if(!u) return;
  try{
    const raw = localStorage.getItem('s2talk_userdata_' + u.uid);
    if(raw){
      const data = JSON.parse(raw);
      if(typeof data.xp === 'number') AppState.xp = data.xp;
      if(typeof data.coins === 'number') AppState.coins = data.coins;
      if(typeof data.level === 'number') AppState.level = data.level;
      AppState.coinsEarned = data.coinsEarned || 0;
      AppState.coinsSpent = data.coinsSpent || 0;
      AppState.coinsBySource = data.coinsBySource || {level:0, game:0, mission:0, other:0};
      AppState.projects = data.projects || [];
      AppState.interview = data.interview || { history: [], scores: [] };
      AppState.quiz = data.quiz || { completed: {}, streak: 0 };
      AppState.recordings = data.recordings || [];
      AppState.photos = data.photos || [];
      AppState.files = data.files || [];
      AppState.receivedMedia = data.receivedMedia || [];
      AppState.notifLog = data.notifLog || [];
      AppState.notifUnread = data.notifUnread || 0;
      if(typeof data.notifications === 'boolean') AppState.notifications = data.notifications;
      if(typeof data.controlsEnabled === 'boolean') AppState.controlsEnabled = data.controlsEnabled;
      if(typeof window.applyControllerEnabledState === 'function') window.applyControllerEnabledState();
      if(data.missions){
        Object.keys(AppState.missions).forEach(key=>{
          if(data.missions[key]) Object.assign(AppState.missions[key], data.missions[key]);
        });
      }
      AppState.resultsViewModes = data.resultsViewModes || { interviews: 'list', skills: 'list', recordings: 'list', photos: 'large', projects: 'list' };
      
      if(data.activeTabs){
        resultsTab = data.activeTabs.resultsTab || 'overview';
        contactsTab = data.activeTabs.contactsTab || 'all';
        mediaTab = data.activeTabs.mediaTab || 'my';
        playTab = data.activeTabs.playTab || 'games';
      }
      if(data.labState){
        if(data.labState.labLang) labLang = data.labState.labLang;
        if(data.labState.labCodeDraft !== undefined) labCodeDraft = data.labState.labCodeDraft;
        if(data.labState.labTerminalSessionOutput !== undefined) labTerminalSessionOutput = data.labState.labTerminalSessionOutput;
        if(data.labState.labStdinDraft !== undefined) labStdinDraft = data.labState.labStdinDraft;
      }
      if(data.pinnedFriends) pinnedFriends = new Set(data.pinnedFriends);
      if(data.activeFriendUid) activeFriendUid = data.activeFriendUid;
      aiSessions = data.aiSessions || [];
      aiCurrentSessionId = data.aiCurrentSessionId || null;
      aiHistory = data.aiHistory || [];

      unlocked.clear();
      if(data.unlocked){
        data.unlocked.forEach(k => unlocked.add(k));
      }
      if (AppState.projects.length) {
        nextProjectId = Math.max(...AppState.projects.map(p => p.id)) + 1;
      }
      if (AppState.recordings.length) {
        nextRecordingId = Math.max(...AppState.recordings.map(r => r.id)) + 1;
      }

      // Auto-restore saved modal or building view
      if(data.currentModalView && data.currentModalView !== 'login' && data.currentModalView !== 'signup'){
        setTimeout(() => {
          if(data.activeBuilding){
            const b = buildings.find(x => x.id === data.activeBuilding);
            if(b) currentBuilding = b;
          }
          const renderMap = {
            lab: renderLab,
            talk: renderTalk,
            contacts: renderContacts,
            results: renderResults,
            media: openMediaPanel,
            play: renderPlay
          };
          if(renderMap[data.currentModalView]){
            openModal(renderMap[data.currentModalView]());
          }
        }, 150);
      }
    } else {
      AppState.xp = 0;
      AppState.coins = 0;
      AppState.level = 1;
      AppState.coinsEarned = 0;
      AppState.coinsSpent = 0;
      AppState.coinsBySource = {level:0, game:0, mission:0, other:0};
      AppState.projects = [];
      AppState.interview = { history: [], scores: [] };
      AppState.quiz = { completed: {}, streak: 0 };
      AppState.recordings = [];
      AppState.photos = [];
      AppState.files = [];
      AppState.receivedMedia = [];
      AppState.notifLog = [];
      AppState.notifUnread = 0;
      AppState.resultsViewModes = { interviews: 'list', skills: 'list', recordings: 'list', photos: 'large', projects: 'list' };
      unlocked.clear();
      nextProjectId = 1;
      nextRecordingId = 1;
    }
    const badge = document.getElementById('xp-badge');
    if(badge) badge.textContent = `⭐ Lv.${AppState.level} · ${AppState.xp} XP · 🪙${AppState.coins}`;
    updateNotifBadge();
  }catch(e){
    console.error('Failed to load user data:', e);
  }
}


let globalPollInterval = null;

async function runBackgroundPolling(){
  if(!AppState.current || !AppState.current.uid) return;
  
  // 1. Poll directory & friends
  try {
    const fdataRes = await fetch('/api/friends/list');
    if(fdataRes.ok){
      const fdata = await fdataRes.json();
      const prevIds = new Set((AppState.incomingRequests||[]).map(r=>r.request_id));
      const incoming = fdata.incoming_requests || [];
      incoming.filter(r=>!prevIds.has(r.request_id)).forEach(r=>{
        pushNotification(`📨 New friend request from ${r.name}`);
        Audio_.friendRequest();
      });
      AppState.incomingRequests = incoming;
      AppState.acceptedFriends = fdata.friends || [];
      
      if(currentModalView==='contacts' && overlay.style.display==='flex' && contactsTab==='requests'){
        renderContactsNow();
      }
    }
  } catch(e){}

  // 2. Poll messages/shares — one request for ALL friends instead of
  //    one request per friend (which didn't scale as the friend list grew).
  const friends = AppState.acceptedFriends || [];
  if(friends.length){
    try{
      const res = await fetch('/api/messages/recent-summary');
      if(res.ok){
        const data = await res.json();
        const byFriend = data.messagesByFriend || {};
        const friendByUid = {};
        friends.forEach(f=>{ friendByUid[f.uid] = f; });

        Object.keys(byFriend).forEach(friendUid=>{
          const friend = friendByUid[friendUid];
          if(!friend) return; // not (or no longer) an accepted friend
          const newMsgs = byFriend[friendUid];
          const oldMsgs = AppState.talkLogMap ? (AppState.talkLogMap[friendUid] || []) : [];

          const newFriendMsgs = newMsgs.filter(m => m.from !== 'me' && !oldMsgs.some(o => o.id === m.id));
          newFriendMsgs.forEach(m => {
            if (m.attachmentType === 'share') {
              let payload = null;
              try { payload = JSON.parse(m.text); } catch(e){}
              if (payload) {
                pushNotification(`🔗 ${friend.name} shared a ${payload.kind}: "${payload.title}"`);
              } else {
                pushNotification(`🔗 ${friend.name} shared content with you`);
              }
            } else if (m.attachmentType === 'voice') {
              pushNotification(`🎙️ New voice message from ${friend.name}`);
            } else {
              pushNotification(`💬 New message from ${friend.name}: "${m.text.slice(0, 30)}${m.text.length > 30 ? '...' : ''}"`);
            }
            Audio_.notification();
          });

          if (!AppState.talkLogMap) AppState.talkLogMap = {};
          AppState.talkLogMap[friendUid] = newMsgs;

          if (currentModalView === 'talk' && overlay.style.display === 'flex' && activeFriendUid === friendUid) {
            const changed = JSON.stringify(newMsgs) !== JSON.stringify(AppState.talkLog || []);
            if (changed) {
              AppState.talkLog = newMsgs;
              const logEl = document.getElementById('talk-log');
              if (logEl) {
                logEl.innerHTML = newMsgs.length ? newMsgs.map((m, index) => renderChatMessage(m, friend.name, index)).join('') : `<p class="sub">No messages yet — say hi!</p>`;
                logEl.scrollTop = logEl.scrollHeight;
              }
            }
          }
        });
      }
    }catch(e){}
  }
}

function loginAs(user){
  AppState.current = user;
  AppState.loginTime = Date.now();
  loadUserData();
  if(user.avatarEmoji) AppState.avatarEmoji = user.avatarEmoji;
  if(user.carColor) AppState.carColor = user.carColor;
  document.getElementById('intro-greeting').textContent = `Welcome, ${user.name.split(' ')[0]}! Your ID is ${user.uid}.`;
  paintProfileChips(user);
  if(typeof window.runS2Loader === 'function'){
    window.runS2Loader(()=>{
      showScreen('intro');
    });
  } else {
    showScreen('intro');
  }

  clearInterval(globalPollInterval);
  globalPollInterval = setInterval(runBackgroundPolling, 8000);
  runBackgroundPolling();
}
function paintProfileChips(user){
  const picHtml = user.pic ? `<img src="${user.pic}">` : (user.avatarEmoji || '🙂');
  document.getElementById('intro-pic').innerHTML = picHtml;
  document.getElementById('intro-name').textContent = user.name;
  document.getElementById('intro-uid').textContent = 'ID: ' + user.uid;
  document.getElementById('hud-profile-pic').innerHTML = picHtml;
  document.getElementById('hud-profile-name').textContent = user.name;
  document.getElementById('hud-profile-uid').textContent = user.uid;
}
async function openReadOnlyProfileModal(targetUid){
  let u = AppState.current;
  if(targetUid && targetUid !== u?.uid){
    const cached = (AppState.realDirectory || []).find(x => x.uid === targetUid) || 
                   (AppState.acceptedFriends || []).find(x => x.uid === targetUid);
    if(cached) u = cached;
    try{
      const res = await fetch('/api/user/' + targetUid);
      if(res.ok){
        const data = await res.json();
        if(data.user) u = data.user;
      }
    }catch(e){}
  }
  if(!u) return;
  const picHtml = u.pic ? `<img src="${u.pic}" alt="${escapeHtml(u.name)}'s profile photo">` : (u.avatarEmoji || '🙂');
  const userAchievements = Object.keys(achievementsDef||{}).filter(k => (typeof unlocked!=='undefined' && unlocked.has(k))).map(k => (achievementsDef[k]||{}).name).filter(Boolean);
  const isSelf = (!targetUid || targetUid === AppState.current?.uid);
  const isOnline = !!u.online;
  const field = (label, value, opts={}) => `
        <div class="pv-field">
          <div class="pv-label">${opts.icon ? opts.icon + ' ' : ''}${escapeHtml(label)}</div>
          <div class="pv-value${value ? '' : ' empty'}">${value ? value : (opts.emptyText || 'Not provided')}</div>
        </div>`;
  const resumeSummaryText = u.bio || u.resumeSummary || '';
  const hasResumeFile = !!(u.resumeUrl && u.resumeFileName);

  openModal(`
    <div class="pv-wrap">
      <div class="pv-overworld-tag">City Overworld</div>
      <div class="pv-head">
        <h2>👤 Profile Viewer</h2>
        <p class="sub">View Only · No Edit Access</p>
      </div>

      <div class="pv-card">
        <div class="pv-photo">${picHtml}</div>
        <h2 class="pv-name">${escapeHtml(u.name)}</h2>
        <div class="pv-uid">Unique ID&nbsp;<b>${escapeHtml(u.uid)}</b></div><br/>
        <span class="pv-online${isOnline ? ' on' : ''}"><span class="dot"></span>${isOnline ? 'Online now' : 'Offline'}</span>

        <div class="pv-body">
          ${field('Bio', u.bio ? escapeHtml(u.bio) : '', {icon:'📝'})}
          ${field('Resume Summary', resumeSummaryText ? escapeHtml(resumeSummaryText) : '', {icon:'📄', emptyText:'Resume summary auto-generated upon upload.'})}
          ${field('Skills', u.skills ? `<div class="pv-chips">${u.skills.split(',').map(s=>s.trim()).filter(Boolean).map(s=>`<span class="tag">${escapeHtml(s)}</span>`).join('')}</div>` : '', {icon:'🛠️'})}
          ${field('Interests', u.interests ? `<div class="pv-chips">${u.interests.split(',').map(s=>s.trim()).filter(Boolean).map(s=>`<span class="tag">${escapeHtml(s)}</span>`).join('')}</div>` : '', {icon:'💡'})}
          ${field('City', u.city ? escapeHtml(u.city) : '', {icon:'📍'})}

          <div class="pv-stats">
            <div class="pv-field"><div class="pv-label">🪙 Coins</div><div class="pv-value">${isSelf ? AppState.coins : (u.score || 0)}</div></div>
            <div class="pv-field"><div class="pv-label">⭐ Level</div><div class="pv-value">${isSelf ? AppState.level : 1}</div></div>
            <div class="pv-field"><div class="pv-label">✨ XP</div><div class="pv-value">${isSelf ? AppState.xp : 0}</div></div>
          </div>

          ${field('Achievements', isSelf ? (userAchievements.length ? userAchievements.join(', ') : '') : 'Member of S2 Talk Community', {icon:'🏆', emptyText:'None unlocked yet'})}
        </div>

        <div class="pv-actions">
          ${hasResumeFile ? `<a class="btn btn-outline btn-sm" href="${u.resumeUrl}" download="${escapeHtml(u.resumeFileName)}">⬇ Download Resume</a>` : ''}
          <button class="btn btn-ghost btn-sm" id="profile-close">Close Viewer</button>
        </div>
      </div>
    </div>
  `);
  const closeBtn = document.getElementById('profile-close');
  if(closeBtn) closeBtn.addEventListener('click', closeModal);
}

document.getElementById('hud-profile-chip').addEventListener('click', ()=>{ openReadOnlyProfileModal(); });
document.getElementById('intro-id-card').addEventListener('click', ()=>{ openReadOnlyProfileModal(); });

document.addEventListener('click', (e)=>{
  const trigger = e.target.closest('[data-profile-uid]');
  if(trigger){
    e.stopPropagation();
    openReadOnlyProfileModal(trigger.dataset.profileUid);
  }
});

/* ---- audio preferences: saved locally so they persist across sessions/devices-in-browser ---- */
function saveAudioPrefs(){
  try{ localStorage.setItem('s2talk_audio_prefs', JSON.stringify({sfxOn:AppState.sfxOn, musicOn:AppState.musicOn, volume:AppState.volume})); }catch(e){}
}
function loadAudioPrefs(){
  try{
    const raw = localStorage.getItem('s2talk_audio_prefs');
    if(!raw) return;
    const prefs = JSON.parse(raw);
    if(typeof prefs.sfxOn==='boolean') AppState.sfxOn=prefs.sfxOn;
    if(typeof prefs.musicOn==='boolean') AppState.musicOn=prefs.musicOn;
    if(typeof prefs.volume==='number') AppState.volume=prefs.volume;
    Audio_.setSfx(AppState.sfxOn); Audio_.setMusic(AppState.musicOn); Audio_.setVolume(AppState.volume);
    const muteBtn = document.getElementById('mute-btn');
    if(muteBtn) muteBtn.textContent = AppState.sfxOn ? '🔊' : '🔇';
  }catch(e){}
}
loadAudioPrefs();
window.addEventListener('beforeunload', ()=>{ if(camStream) camStream.getTracks().forEach(t=>t.stop()); });

(async function restoreSession(){
  try{
    const res = await fetch('/api/me');
    if(res.ok){
      const data = await res.json();
      if(data.user){
        AppState.current = data.user;
        if(data.user.avatarEmoji) AppState.avatarEmoji = data.user.avatarEmoji;
        if(data.user.carColor) AppState.carColor = data.user.carColor;
        paintProfileChips(data.user);
        loadUserData();
        showScreen('intro');
        
        clearInterval(globalPollInterval);
        globalPollInterval = setInterval(runBackgroundPolling, 8000);
        runBackgroundPolling();
      }
    }
  }catch(e){ /* backend not reachable yet — stay on landing */ }
})();

/* ============================================================
   AUDIO (procedural, no external files)
   ============================================================ */
const Audio_ = (function(){
  const cfg = window.S2AudioConfig || {soundsPath:'', musicPath:'', sounds:{}, music:{}, defaultVolume:0.5};
  let ctx=null, master=null, ambientGain=null, rainSrc=null, musicEl=null;
  let sfxOn=true, musicOn=true, started=false, lastFootstep=0, volume=cfg.defaultVolume ?? 0.5;

  function init(){
    if(started) return; started=true;
    ctx = new (window.AudioContext||window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value=0.10*volume*2; master.connect(ctx.destination);
    ambientGain = ctx.createGain(); ambientGain.gain.value=0.025*volume*2; ambientGain.connect(ctx.destination);
  }
  function setVolume(v){
    volume = Math.max(0, Math.min(1, v));
    if(master) master.gain.value = 0.10*volume*2;
    if(ambientGain) ambientGain.gain.value = 0.025*volume*2;
    if(musicEl) musicEl.volume = volume;
  }
  // Try to play a real audio file configured in /static/config/audio.js.
  // Returns true if a file was configured and playback was attempted
  // (caller should skip its synthesized fallback), false if no file is
  // configured for this key (caller should use its synthesized sound).
  function tryPlayFile(key, fallbackFn){
    const name = cfg.sounds && cfg.sounds[key];
    if(!name) return false;
    if(!sfxOn) return true; // configured but muted — still "handled", just silent
    const el = new Audio((cfg.soundsPath||'') + name);
    el.volume = volume;
    el.addEventListener('error', ()=>{ if(fallbackFn) fallbackFn(); }); // missing/broken file → fall back gracefully
    el.play().catch(()=>{ if(fallbackFn) fallbackFn(); });
    return true;
  }
  function blip(freq){
    if(!ctx || !sfxOn) return;
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type='sine'; o.frequency.value=freq;
    g.gain.value=0.001; g.gain.linearRampToValueAtTime(0.09, ctx.currentTime+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.25);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime+0.27);
  }
  function enterHouse(){ if(!sfxOn) return; if(tryPlayFile('enterHouse')) return; if(!ctx) return; blip(660); setTimeout(()=>blip(880),90); }
  function exitHouse(){ if(!sfxOn) return; if(tryPlayFile('exitHouse')) return; if(!ctx) return; blip(520); setTimeout(()=>blip(340),90); }
  function notification(){ if(!sfxOn) return; if(tryPlayFile('notification')) return; if(!ctx) return; blip(740); }
  function messageSent(){ if(!sfxOn) return; if(tryPlayFile('messageSent')) return; if(!ctx) return; blip(590); }
  function friendRequest(){ if(!sfxOn) return; if(tryPlayFile('friendRequest')) return; if(!ctx) return; blip(660); setTimeout(()=>blip(990),100); }
  function recordStart(){ if(!sfxOn) return; if(tryPlayFile('recordStart')) return; if(!ctx) return; blip(880); }
  function recordStop(){ if(!sfxOn) return; if(tryPlayFile('recordStop')) return; if(!ctx) return; blip(440); }
  function footstep(){
    if(!sfxOn) return;
    if(tryPlayFile('footstep')) return;
    if(!ctx) return;
    const t=ctx.currentTime;
    if(t-lastFootstep < 0.42) return; // gentle, not machine-gun footsteps
    lastFootstep=t;
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type='triangle'; o.frequency.value=130+Math.random()*15;
    g.gain.value=0.0001; g.gain.linearRampToValueAtTime(0.025, t+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.1);
    o.connect(g); g.connect(master); o.start(t); o.stop(t+0.11);
  }
  function carStart(){
    if(!sfxOn) return;
    if(tryPlayFile('carStart')) return;
    if(!ctx) return;
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type='sawtooth'; o.frequency.setValueAtTime(60, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(130, ctx.currentTime+0.3);
    g.gain.value=0.001; g.gain.linearRampToValueAtTime(0.05, ctx.currentTime+0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.4);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime+0.4);
  }
  function horn(){
    if(!sfxOn) return;
    if(tryPlayFile('horn')) return;
    if(!ctx) return;
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type='square'; o.frequency.value=330;
    g.gain.value=0.001; g.gain.linearRampToValueAtTime(0.06, ctx.currentTime+0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.35);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime+0.35);
  }
  // continuous engine drone removed — it was the main source of complaints;
  // carStart() alone gives audio feedback for entering/exiting car mode.
  function driveHum(){ /* intentionally no-op now — see note above */ }
  function stopDriveHum(){}
  function startRain(){
    if(!musicOn || rainSrc || musicEl) return;
    const fileName = cfg.music && cfg.music.rain;
    if(fileName){
      musicEl = new Audio((cfg.musicPath||'') + fileName);
      musicEl.loop = true; musicEl.volume = volume;
      musicEl.addEventListener('error', ()=>{ musicEl=null; startSynthRain(); });
      musicEl.play().catch(()=>{ musicEl=null; startSynthRain(); });
      return;
    }
    startSynthRain();
  }
  function startSynthRain(){
    if(!ctx || rainSrc) return;
    const bufferSize = 2*ctx.sampleRate;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for(let i=0;i<bufferSize;i++) data[i]=(Math.random()*2-1)*0.35;
    rainSrc = ctx.createBufferSource(); rainSrc.buffer=buffer; rainSrc.loop=true;
    const filter=ctx.createBiquadFilter(); filter.type='highpass'; filter.frequency.value=1200;
    rainSrc.connect(filter); filter.connect(ambientGain); rainSrc.start();
  }
  function stopRain(){
    if(rainSrc){ try{rainSrc.stop();}catch(e){} rainSrc=null; }
    if(musicEl){ try{musicEl.pause();}catch(e){} musicEl=null; }
  }
  // ---- single source of truth for on/off state ----
  // AppState.sfxOn / AppState.musicOn (persisted to localStorage) drive
  // everything; both the HUD button and the Settings toggles call these
  // same two functions so they can never fall out of sync with each other.
  function setSfx(on){ sfxOn=on; }
  function setMusic(on){ musicOn=on; if(!on) stopRain(); }
  function isSfxOn(){ return sfxOn; }
  function isMusicOn(){ return musicOn; }
  return {init, blip, enterHouse, exitHouse, notification, messageSent, friendRequest, recordStart, recordStop,
          footstep, carStart, horn, driveHum, startRain, stopRain, setSfx, setMusic, setVolume, isSfxOn, isMusicOn};
})();

document.getElementById('start-btn').addEventListener('click', ()=>{
  Audio_.init();
  if (window.AnimationManager && typeof window.AnimationManager.showCityLoader === 'function') {
    window.AnimationManager.showCityLoader(() => {
      showScreen('game');
      requestAnimationFrame(gameLoop);
    });
  } else {
    showScreen('game');
    requestAnimationFrame(gameLoop);
  }
});

/* ============================================================
   GAME WORLD
   ============================================================ */
const canvas = document.getElementById('world');
const ctx2d = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
let night=false, raining=false, carMode=false;
const keys={};
function bindKeyboardControls(){
  window.addEventListener('keydown', e=>{
    if(!e.key) return; // guards against synthetic/composition events with no key info (autofill, some mobile IMEs)
    keys[e.key.toLowerCase()]=true;
    const tag=(e.target&&e.target.tagName||'').toLowerCase();
    const typing = tag==='input' || tag==='textarea' || (e.target&&e.target.isContentEditable);
    if(typing) return; // never hijack game hotkeys while the user is typing anywhere in the UI
    const onGameScreen = document.getElementById('game').classList.contains('active');
    if(e.key==='Enter' && onGameScreen) tryEnter();
    if(e.key.toLowerCase()==='c'){
      carMode=!carMode;
      if(carMode){
        const cx=player.x+player.w/2, cy=player.y+player.h/2;
        const nearestY = ROAD_Y.reduce((a,b)=>Math.abs(b-cy)<Math.abs(a-cy)?b:a);
        const nearestX = ROAD_X.reduce((a,b)=>Math.abs(b-cx)<Math.abs(a-cx)?b:a);
        // hop onto whichever road (horizontal or vertical) is closer
        if(Math.abs(nearestY-cy) <= Math.abs(nearestX-cx)) player.y = nearestY-player.h/2;
        else player.x = nearestX-player.w/2;
        Audio_.carStart();
      }
      Audio_.driveHum(carMode);
      toast(carMode?"🚗 Car mode ON":"🚶 Back on foot");
    }
    if(e.key.toLowerCase()==='r'){ raining=!raining; if(raining) Audio_.startRain(); else Audio_.stopRain(); toast(raining?"🌧 Rain rolling in...":"☀ Skies clearing"); }
    if(e.key.toLowerCase()==='h' && carMode) Audio_.horn();
    const n=parseInt(e.key);
    if(!isNaN(n) && n>=1 && n<=9 && buildings[n-1]){
      const b=buildings[n-1];
      player.x=b.x+b.w/2; player.y=b.y+b.h+26;
      toast("🚇 Fast travel: "+houseLabel(b));
    }
  });
  window.addEventListener('keyup', e=>{ if(e.key) keys[e.key.toLowerCase()]=false; });
}
bindKeyboardControls();

const buildings = [
  {num:1, id:'interview', name:'Interview House', icon:'🎤', x:60, y:50, w:150, h:120, color:'#3B82F6', accent:'#93C5FD', render:renderInterview, glow:true},
  {num:2, id:'skills', name:'Skills Development House', icon:'📚', x:400, y:45, w:150, h:120, color:'#14B8A6', accent:'#5EEAD4', render:renderSkills},
  {num:3, id:'lab', name:'Projects Lab', icon:'💻', x:730, y:55, w:150, h:120, color:'#8B5CF6', accent:'#C4B5FD', render:renderLab},
  {num:4, id:'talk', name:'Talk House', icon:'💬', x:60, y:250, w:150, h:110, color:'#22D3EE', accent:'#A5F3FC', render:renderTalk},
  {num:5, id:'ai', name:'S2 AI Agent House', icon:'🤖', x:400, y:255, w:150, h:110, color:'#F6A300', accent:'#FFD166', render:renderAI, glow:true},
  {num:6, id:'results', name:'Results House', icon:'📊', x:730, y:255, w:150, h:110, color:'#10B981', accent:'#6EE7B7', render:renderResults},
  {num:7, id:'contacts', name:'Contacts House', icon:'👥', x:60, y:450, w:150, h:110, color:'#F472B6', accent:'#FBCFE8', render:renderContacts},
  {num:8, id:'settings', name:'About & Settings House', icon:'⚙️', x:400, y:455, w:150, h:110, color:'#6B7280', accent:'#D1D5DB', render:renderSettings},
  {num:9, id:'play', name:'Play House', icon:'🎮', x:730, y:450, w:150, h:110, color:'#EC4899', accent:'#F9A8D4', render:renderPlay},
];
function houseLabel(b){ return `House ${String(b.num).padStart(2,'0')} — ${b.name}`; }

const player={x:450, y:320, w:22, h:28, speed:2.6, dir:'down', trail:[]};
let nearBuilding=null;
function updatePlayer(dt){
  let dx=0,dy=0;
  if(keys['w']||keys['arrowup']){dy=-1; player.dir='up';}
  if(keys['s']||keys['arrowdown']){dy=1; player.dir='down';}
  if(keys['a']||keys['arrowleft']){dx=-1; player.dir='left';}
  if(keys['d']||keys['arrowright']){dx=1; player.dir='right';}
  if(dx||dy){
    const len=Math.hypot(dx,dy)||1;
    const spd=player.speed*(carMode?1.9:1);
    let nx=player.x+(dx/len)*spd, ny=player.y+(dy/len)*spd;
    if(carMode){
      const cx=player.x+player.w/2, cy=player.y+player.h/2;
      const onHRoad = ROAD_Y.some(ry=>Math.abs(cy-ry)<18);
      const onVRoad = ROAD_X.some(rx=>Math.abs(cx-rx)<18);
      // cars may only drive along a road corridor: sideways while on a
      // horizontal road, or up/down while on a vertical road.
      if(dx && !onHRoad) nx = player.x;
      if(dy && !onVRoad) ny = player.y;
      // gently keep the car centered in whichever corridor it's using
      if(onHRoad && dx){ const nearest=ROAD_Y.reduce((a,b)=>Math.abs(b-cy)<Math.abs(a-cy)?b:a); ny += (nearest-cy)*0.15; }
      if(onVRoad && dy){ const nearest=ROAD_X.reduce((a,b)=>Math.abs(b-cx)<Math.abs(a-cx)?b:a); nx += (nearest-cx)*0.15; }
    }
    player.x=nx; player.y=ny;
    if(!carMode) Audio_.footstep();
  }
  player.x=Math.max(10,Math.min(W-player.w-10, player.x));
  player.y=Math.max(10,Math.min(H-player.h-10, player.y));
  nearBuilding=null;
  for(const b of buildings){
    const pad=16;
    if(player.x+player.w>b.x-pad && player.x<b.x+b.w+pad && player.y+player.h>b.y-pad && player.y<b.y+b.h+pad){ nearBuilding=b; break; }
  }
  const promptEl=document.getElementById('prompt-enter');
  if(nearBuilding){
    promptEl.style.display='block';
    const rect=document.getElementById('world').getBoundingClientRect();
    const sx=rect.width/W, sy=rect.height/H;
    promptEl.style.left=(nearBuilding.x+nearBuilding.w/2)*sx-60+'px';
    promptEl.style.top=(nearBuilding.y-26)*sy+'px';
  } else promptEl.style.display='none';
}
function tryEnter(){ if(nearBuilding) visitBuilding(nearBuilding); }

function shade(hex, pct){
  const n=parseInt(hex.slice(1),16);
  let r=(n>>16)+pct, g=(n>>8&255)+pct, b=(n&255)+pct;
  r=Math.max(0,Math.min(255,r)); g=Math.max(0,Math.min(255,g)); b=Math.max(0,Math.min(255,b));
  return '#'+(1<<24|r<<16|g<<8|b).toString(16).slice(1);
}
const ROAD_Y=[210, 407];
const ROAD_X=[315, 650];
function drawRoads(){
  ctx2d.save();
  ctx2d.fillStyle= night? '#2B2C52':'#C7C4E8';
  ROAD_Y.forEach(y=> ctx2d.fillRect(0, y-16, W, 32));
  ROAD_X.forEach(x=> ctx2d.fillRect(x-16, 0, 32, H));
  ctx2d.strokeStyle= night? 'rgba(255,255,255,0.3)':'rgba(255,255,255,0.75)';
  ctx2d.setLineDash([10,10]); ctx2d.lineWidth=2;
  ROAD_Y.forEach(y=>{ ctx2d.beginPath(); ctx2d.moveTo(0,y); ctx2d.lineTo(W,y); ctx2d.stroke(); });
  ROAD_X.forEach(x=>{ ctx2d.beginPath(); ctx2d.moveTo(x,0); ctx2d.lineTo(x,H); ctx2d.stroke(); });
  ctx2d.setLineDash([]); ctx2d.restore();
}
function drawTrafficLights(){
  const t=Date.now();
  ROAD_X.forEach((x,ix)=>{
    ROAD_Y.forEach((y,iy)=>{
      const phase=Math.floor(t/1600 + ix*0.7 + iy*1.3)%3;
      const color= phase===0? '#1FBFA0' : phase===1? '#FFB648' : '#FF6F5E';
      ctx2d.save();
      ctx2d.fillStyle='#33334d'; ctx2d.fillRect(x+18, y-36, 7, 24);
      ctx2d.fillStyle=color; ctx2d.beginPath(); ctx2d.arc(x+21, y-40, 6, 0, 7); ctx2d.fill();
      ctx2d.restore();
    });
  });
}
function drawNpcCars(){
  const t=performance.now()/1000;
  ctx2d.save(); ctx2d.font='18px sans-serif'; ctx2d.textAlign='center';
  ROAD_Y.forEach((y,i)=>{
    const speed=70+i*22;
    const x=((t*speed + i*260) % (W+100)) - 50;
    ctx2d.fillText('🚗', x, y+6);
  });
  ROAD_X.forEach((x,i)=>{
    const speed=55+i*18;
    const y=((t*speed + i*180) % (H+100)) - 50;
    ctx2d.save(); ctx2d.translate(x,y); ctx2d.rotate(Math.PI/2); ctx2d.fillText('🚙',0,6); ctx2d.restore();
  });
  ctx2d.restore();
}
function drawBackground(){
  const g=ctx2d.createLinearGradient(0,0,0,H);
  if(night){ g.addColorStop(0,'#141539'); g.addColorStop(1,'#232358'); }
  else { g.addColorStop(0,'#CDE8FF'); g.addColorStop(1,'#DFF3E4'); }
  ctx2d.fillStyle=g; ctx2d.fillRect(0,0,W,H);
  ctx2d.strokeStyle= night?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.05)';
  for(let x=0;x<W;x+=40){ctx2d.beginPath();ctx2d.moveTo(x,0);ctx2d.lineTo(x,H);ctx2d.stroke();}
  for(let y=0;y<H;y+=40){ctx2d.beginPath();ctx2d.moveTo(0,y);ctx2d.lineTo(W,y);ctx2d.stroke();}
  if(night){ ctx2d.fillStyle='rgba(255,255,255,0.55)'; for(let i=0;i<50;i++){ ctx2d.fillRect((i*97)%W,(i*53)%200,2,2);} }
}
function roundRectPath(c,x,y,w,h,r){
  c.beginPath();
  c.moveTo(x+r,y);
  c.arcTo(x+w,y,x+w,y+h,r);
  c.arcTo(x+w,y+h,x,y+h,r);
  c.arcTo(x,y+h,x,y,r);
  c.arcTo(x,y,x+w,y,r);
  c.closePath();
}
function drawBuilding(b){
  const t=Date.now()/1000;
  const bob=Math.sin(t*1.5 + b.num*0.8)*3;          /* gentle idle float */
  const isNear = nearBuilding===b;
  const pulse=0.5+0.5*Math.sin(t*1.7 + b.num*1.3);   /* breathing glow */
  const accent=b.accent || shade(b.color,30);

  ctx2d.save();
  ctx2d.translate(0, bob + (isNear?-3:0));

  /* ambient glow (stronger for hero buildings + when the player is close) */
  ctx2d.shadowColor = night ? accent : b.color;
  ctx2d.shadowBlur = (b.glow ? 20 : 9) + pulse*9 + (isNear? 16:0);

  /* body — vertical premium gradient */
  const bodyGrad=ctx2d.createLinearGradient(b.x, b.y+20, b.x, b.y+b.h);
  bodyGrad.addColorStop(0, shade(b.color, night?24:8));
  bodyGrad.addColorStop(1, shade(b.color, night?-14:-26));
  ctx2d.fillStyle=bodyGrad;
  roundRectPath(ctx2d, b.x, b.y+20, b.w, b.h-20, 10);
  ctx2d.fill();
  ctx2d.strokeStyle = night ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.35)';
  ctx2d.lineWidth=1.2; ctx2d.stroke();

  /* roof — accent-lit gradient */
  ctx2d.shadowBlur = ctx2d.shadowBlur*0.6;
  const roofGrad=ctx2d.createLinearGradient(b.x, b.y-8, b.x, b.y+22);
  roofGrad.addColorStop(0, accent);
  roofGrad.addColorStop(1, shade(b.color, night?4:-8));
  ctx2d.fillStyle=roofGrad;
  ctx2d.beginPath(); ctx2d.moveTo(b.x-6,b.y+22); ctx2d.lineTo(b.x+b.w/2,b.y-8); ctx2d.lineTo(b.x+b.w+6,b.y+22); ctx2d.closePath(); ctx2d.fill();

  /* glass window strip — subtle flicker, accent-tinted at night */
  ctx2d.shadowBlur=0;
  const cols=Math.max(1,Math.floor(b.w/34));
  for(let i=0;i<cols;i++){
    ctx2d.globalAlpha = night ? (0.65+0.35*Math.sin(t*2.2+i+b.num)) : 0.9;
    ctx2d.fillStyle = night ? accent : 'rgba(255,255,255,0.7)';
    ctx2d.fillRect(b.x+10+i*32, b.y+38, 12, 12);
  }
  ctx2d.globalAlpha=1;

  /* door */
  ctx2d.fillStyle='#1a1a1a'; ctx2d.fillRect(b.x+b.w/2-12, b.y+b.h-26, 24, 26);
  ctx2d.restore();

  /* icon + label — drawn without heavy shadow so text stays crisp */
  ctx2d.save();
  ctx2d.translate(0, bob + (isNear?-3:0));
  ctx2d.font=(isNear? '25px':'22px')+' sans-serif'; ctx2d.textAlign='center';
  ctx2d.fillText(b.icon, b.x+b.w/2, b.y-14);
  ctx2d.font='700 11px "Plus Jakarta Sans", sans-serif';
  ctx2d.fillStyle= night?'#F1F0FF':'#1B1B2F';
  ctx2d.fillText('H'+String(b.num).padStart(2,'0')+' · '+b.name, b.x+b.w/2, b.y+b.h+16);
  ctx2d.restore();

  /* ambient orbiting particles around hero (glow) buildings */
  if(b.glow){
    ctx2d.save();
    ctx2d.translate(0, bob);
    for(let i=0;i<4;i++){
      const ang=t*0.7 + i*(Math.PI/2);
      const px=b.x+b.w/2 + Math.cos(ang)*(b.w/2+16);
      const py=b.y+b.h/2 + Math.sin(ang)*(b.h/2+16)*0.55;
      ctx2d.globalAlpha=0.35+0.4*Math.sin(t*2+i+b.num);
      ctx2d.fillStyle=accent;
      ctx2d.beginPath(); ctx2d.arc(px,py,2.2,0,7); ctx2d.fill();
    }
    ctx2d.restore();
  }
}
function drawPlayer(){
  ctx2d.save();
  const cx=player.x+player.w/2, cy=player.y+player.h/2;
  if(carMode){
    ctx2d.fillStyle=AppState.carColor; ctx2d.fillRect(player.x-6, player.y+6, player.w+12, player.h-8);
    ctx2d.fillStyle='#111'; ctx2d.beginPath(); ctx2d.arc(player.x-2, player.y+player.h, 5,0,7); ctx2d.arc(player.x+player.w+2, player.y+player.h,5,0,7); ctx2d.fill();
  } else {
    ctx2d.font='24px sans-serif'; ctx2d.textAlign='center'; ctx2d.textBaseline='middle';
    ctx2d.fillText(AppState.avatarEmoji, cx, cy);
  }
  ctx2d.restore();
}
const RAIN_IS_TOUCH = (typeof window!=='undefined' && window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
const RAIN_LAYERS = [
  /* far  */ { count: RAIN_IS_TOUCH?40:65, speed:260, len:7,  width:1,   alpha:0.20, sway:1.5 },
  /* mid  */ { count: RAIN_IS_TOUCH?30:50, speed:430, len:12, width:1.3, alpha:0.36, sway:2.5 },
  /* near */ { count: RAIN_IS_TOUCH?22:38, speed:640, len:18, width:1.8, alpha:0.55, sway:4   },
];
const RAIN_SPLASH_POINTS = (()=>{
  const pts=[];
  ROAD_Y.forEach(y=>{ for(let i=0;i<5;i++) pts.push({x:(i+0.5)*(W/5) + (i%2?18:-18), y, phase:Math.random()}); });
  return pts;
})();
function drawRain(){
  if(!raining) return;
  ctx2d.save();
  const t = performance.now()/1000;
  const wind = Math.sin(t*0.28)*16 + Math.sin(t*0.71)*6; // layered slow gusts, px offset
  let seed = 0;
  RAIN_LAYERS.forEach(layer=>{
    ctx2d.lineWidth = layer.width;
    ctx2d.strokeStyle = `rgba(185,205,255,${layer.alpha})`;
    ctx2d.beginPath();
    for(let i=0;i<layer.count;i++){
      const s = seed + i;
      const speedJitter = 0.75 + ((s*0.6180339887) % 1) * 0.6;      // 0.75x–1.35x per-drop speed variance
      const fallSpeed = layer.speed * speedJitter;
      const colX = (s * 53.7) % (W + 60) - 30;                      // stable per-drop column
      const y = ((t*fallSpeed) + (s*131) % (H+40)) % (H+40) - 20;
      const x = colX + wind*(layer.speed/640) + Math.sin(t*1.3 + s)*layer.sway;
      ctx2d.moveTo(x, y);
      ctx2d.lineTo(x - layer.len*0.25, y + layer.len);
    }
    ctx2d.stroke();
    seed += layer.count;
  });

  /* ground splashes — small expanding, fading rings along the road lines */
  ctx2d.strokeStyle = 'rgba(210,225,255,0.5)';
  ctx2d.lineWidth = 1.2;
  RAIN_SPLASH_POINTS.forEach(p=>{
    const cycle = 0.7 + p.phase*0.5;                    // 0.7–1.2s per splash cycle
    const local = ((t + p.phase*cycle) % cycle) / cycle; // 0..1
    if(local > 0.55) return;                             // splash visible for first ~55% of its cycle
    const prog = local/0.55;
    const r = 2 + prog*7;
    ctx2d.globalAlpha = (1-prog) * 0.6;
    ctx2d.beginPath();
    ctx2d.ellipse(p.x, p.y, r, r*0.4, 0, 0, Math.PI*2);
    ctx2d.stroke();
  });
  ctx2d.globalAlpha = 1;
  ctx2d.restore();
}
let lastT=performance.now();
function gameLoop(t){
  updatePlayer(t-lastT); lastT=t;
  drawBackground();
  drawRoads();
  buildings.slice().sort((a,b)=>a.y-b.y).forEach(drawBuilding);
  drawTrafficLights();
  drawNpcCars();
  drawRain(); drawPlayer();
  requestAnimationFrame(gameLoop);
}

/* ---- visits / achievements / toast ---- */
const visited=new Set();
const achievementsDef = {
  explorer:{name:'City Explorer', icon:'🏆', desc:'Visit all nine buildings'},
  interview:{name:'Interview Ready', icon:'🎤', desc:'Complete a mock interview'},
  coder:{name:'Code Runner', icon:'💻', desc:'Run code in the Projects Lab'},
  social:{name:'People Person', icon:'👥', desc:'Add a friend'},
  gamer:{name:'Game On', icon:'🎮', desc:'Play a mini-game'},
  quiz:{name:'Quiz Whiz', icon:'📚', desc:'Complete a skills quiz'},
};
const unlocked=new Set();
function unlockAchievement(key){
  if(unlocked.has(key)) return; unlocked.add(key);
  const def=achievementsDef[key]; if(def){ toast('🏆 '+def.name+' unlocked!'); pushNotification('🏆 Achievement unlocked: '+def.name); }
  Audio_.blip(700);
}
/* ---- Notifications: bell button, panel, and unread count ---- */
function pushNotification(msg){
  if(AppState.notifications===false) return; // respects the Settings "Notifications" toggle
  AppState.notifLog.unshift({msg, date:new Date().toLocaleString(), read:false});
  if(AppState.notifLog.length>30) AppState.notifLog.length=30;
  AppState.notifUnread=(AppState.notifUnread||0)+1;
  updateNotifBadge();
  saveUserData();
}
function updateNotifBadge(){
  const el=document.getElementById('notif-count');
  if(!el) return;
  const n=AppState.notifUnread||0;
  el.style.display = n>0 ? 'flex' : 'none';
  el.textContent = n>9 ? '9+' : String(n);
}
let notifSelectMode = false;
let notifSelected = new Set();

function renderNotifPanel(){
  const log = AppState.notifLog || [];
  const items = log.map((n, i)=>`
    <div class="item-card" style="display:flex;align-items:center;gap:10px;opacity:${n.read?0.6:1};">
      ${notifSelectMode ? `<input type="checkbox" class="notif-select-box" data-notif-select="${i}" ${notifSelected.has(i)?'checked':''}>` : ''}
      <div style="flex:1;">
        <div>${escapeHtml(n.msg)}</div>
        <div class="sub">${n.date}</div>
      </div>
      ${!notifSelectMode && !n.read ? `<button class="btn btn-sm btn-ghost" data-read-notif="${i}">✓ Read</button>` : ''}
      ${!notifSelectMode ? `<button class="btn btn-sm btn-ghost" data-del-notif="${i}" style="color:#FF6F5E;" title="Delete">🗑️</button>` : ''}
    </div>`).join('');

  return `
    <h2>🔔 Notifications (${log.length})</h2>
    ${log.length ? `
    <div class="pill-row" style="margin-bottom:8px;gap:6px;">
      <button class="btn btn-ghost btn-sm" id="notif-select-toggle">${notifSelectMode ? 'Cancel' : '☑ Select'}</button>
      ${notifSelectMode ? `
        <button class="btn btn-ghost btn-sm" id="notif-select-all">${notifSelected.size === log.length ? 'Deselect All' : 'Select All'}</button>
        <button class="btn btn-sm" id="notif-delete-selected" style="background:#FF6F5E;color:#fff;" ${notifSelected.size ? '' : 'disabled'}>🗑️ Delete Selected (${notifSelected.size})</button>
      ` : ''}
      <button class="btn btn-ghost btn-sm" id="notif-clear-all" style="color:#FF6F5E;margin-left:auto;">🗑️ Clear All</button>
    </div>` : ''}
    ${items || '<p class="sub">No notifications yet.</p>'}
  `;
}

function wireNotifPanel(){
  const clearBtn = document.getElementById('notif-clear-all');
  if(clearBtn) clearBtn.addEventListener('click', ()=>{
    window.showCustomConfirm('Clear Notifications', 'Clear all notifications?', 'Notifications Cleared', () => {
      AppState.notifLog = [];
      AppState.notifUnread = 0;
      notifSelected.clear();
      notifSelectMode = false;
      updateNotifBadge();
      saveUserData();
      toast('🗑️ Notifications cleared.');
      openModal(renderNotifPanel());
      wireNotifPanel();
    });
  });

  const selectToggle = document.getElementById('notif-select-toggle');
  if(selectToggle) selectToggle.addEventListener('click', ()=>{
    notifSelectMode = !notifSelectMode;
    notifSelected.clear();
    openModal(renderNotifPanel());
    wireNotifPanel();
  });

  const selectAllBtn = document.getElementById('notif-select-all');
  if(selectAllBtn) selectAllBtn.addEventListener('click', ()=>{
    const log = AppState.notifLog || [];
    if(notifSelected.size === log.length){
      notifSelected.clear();
    } else {
      log.forEach((_, i) => notifSelected.add(i));
    }
    openModal(renderNotifPanel());
    wireNotifPanel();
  });

  const delSelBtn = document.getElementById('notif-delete-selected');
  if(delSelBtn) delSelBtn.addEventListener('click', ()=>{
    if(!notifSelected.size) return;
    const log = AppState.notifLog || [];
    AppState.notifLog = log.filter((_, i) => !notifSelected.has(i));
    notifSelected.clear();
    notifSelectMode = false;
    AppState.notifUnread = (AppState.notifLog || []).filter(n=>!n.read).length;
    updateNotifBadge();
    saveUserData();
    toast('🗑️ Deleted selected notifications.');
    openModal(renderNotifPanel());
    wireNotifPanel();
  });

  document.querySelectorAll('[data-notif-select]').forEach(cb => cb.addEventListener('change', ()=>{
    const idx = parseInt(cb.dataset.notifSelect);
    if(cb.checked) notifSelected.add(idx); else notifSelected.delete(idx);
    const delBtn = document.getElementById('notif-delete-selected');
    if(delBtn){
      delBtn.disabled = notifSelected.size === 0;
      delBtn.textContent = `🗑️ Delete Selected (${notifSelected.size})`;
    }
  }));

  document.querySelectorAll('[data-del-notif]').forEach(btn => btn.addEventListener('click', ()=>{
    const idx = parseInt(btn.dataset.delNotif);
    (AppState.notifLog || []).splice(idx, 1);
    AppState.notifUnread = (AppState.notifLog || []).filter(n=>!n.read).length;
    updateNotifBadge();
    saveUserData();
    toast('🗑️ Notification deleted.');
    openModal(renderNotifPanel());
    wireNotifPanel();
  }));

  document.querySelectorAll('[data-read-notif]').forEach(btn => btn.addEventListener('click', ()=>{
    const idx = parseInt(btn.dataset.readNotif);
    if(AppState.notifLog[idx]) AppState.notifLog[idx].read = true;
    AppState.notifUnread = (AppState.notifLog || []).filter(n=>!n.read).length;
    updateNotifBadge();
    saveUserData();
    openModal(renderNotifPanel());
    wireNotifPanel();
  }));
}

document.getElementById('notif-btn').addEventListener('click', function(){
  currentModalView='notifications';
  (AppState.notifLog || []).forEach(n => n.read = true);
  AppState.notifUnread=0;
  updateNotifBadge();
  saveUserData();
  openModal(renderNotifPanel());
  wireNotifPanel();
});
function toast(msg){
  const el=document.createElement('div'); el.className='toast'; el.textContent=msg;
  document.getElementById('toast-wrap').appendChild(el);
  setTimeout(()=>el.remove(), 3700);
}
// Tracks which modal is actually on screen right now (independent of the HUD
// area-label, which mission/achievement buttons don't update). Async callbacks
// (leaderboard fetch, friends fetch, etc.) check this before overwriting the
// modal, so a late response can no longer stomp on a house the user has since
// navigated away from — this fixes the Result House / Daily Missions bug.
let currentModalView=null;
function visitBuilding(b){
  currentModalView=b.id;
  if(b.id!=='interview' && (camStream || (recorder && recorder.state!=='inactive'))) cleanupInterviewMedia();
  if(b.id!=='talk') stopVoiceRecorderIfActive();
  if(b.id!=='play'){
    if(g2048KeyHandler){ window.removeEventListener('keydown', g2048KeyHandler); g2048KeyHandler=null; }
    resetPlayHouseGames();
  }
  const isNew = !visited.has(b.id);
  visited.add(b.id);
  if(isNew){ addXP(5); AppState.missions.visit3.progress = Math.min(3, visited.size); }
  if(buildings.every(bb=>visited.has(bb.id))) unlockAchievement('explorer');
  
  if(b.id === 'talk' || b.id === 'contacts') {
    fetch('/api/friends/list').then(res => {
      if(res.ok) return res.json();
    }).then(data => {
      if(data) {
        AppState.incomingRequests = data.incoming_requests || [];
        AppState.acceptedFriends = data.friends || [];
        if (currentModalView === b.id && overlay.style.display === 'flex') {
          openModal(b.render());
        }
      }
    }).catch(e => {});
  }
  
  document.getElementById('area-label').textContent=houseLabel(b);
  openModal(b.render());
  Audio_.enterHouse();
}

/* ---- modal control ---- */
const overlay=document.getElementById('modal-overlay');
const modalBody=document.getElementById('modal-body');
function openModal(html){ modalBody.innerHTML=html; overlay.style.display='flex'; wireModalExtras(); }
function closeModal(){
  // Global House Exit System — always release camera/mic/audio streams,
  // stop any in-progress recording, and reset temporary game state so
  // nothing lingers in the background once the user leaves a house.
  cleanupInterviewMedia();
  stopVoiceRecorderIfActive();
  if(g2048KeyHandler){ window.removeEventListener('keydown', g2048KeyHandler); g2048KeyHandler=null; }
  resetPlayHouseGames();
  clearInterval(talkPollTimer); talkPollTimer=null;
  currentModalView=null;
  overlay.style.display='none'; Audio_.exitHouse();
  if(typeof keys !== 'undefined'){ for(const k in keys) keys[k]=false; }
  const al=document.getElementById('area-label'); if(al) al.textContent='City Overworld';
}
function stopVoiceRecorderIfActive(){
  if(voiceRecorder && voiceRecorder.state==='recording'){
    try{ voiceRecorder.stop(); }catch(e){}
  } else if(voiceStream){
    voiceStream.getTracks().forEach(t=>t.stop()); voiceStream=null;
  }
}
function resetPlayHouseGames(){
  ttt=Array(9).fill(null); tttOver=false; tttStartTime=Date.now(); tttCharged=false;
  memState=null; memCharged=false;
  rpsScore={win:0,loss:0,draw:0}; rpsRound=0; rpsCharged=false;
  c4Charged=false;
  g2048Charged=false;
  typingState=null;
}
document.getElementById('modal-close').addEventListener('click', closeModal);
overlay.addEventListener('click', e=>{ if(e.target===overlay) closeModal(); });
window.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });

document.getElementById('daynight-btn').addEventListener('click', function(){
  night=!night; document.body.classList.toggle('night', night);
  this.textContent= night?'☀':'🌙';
  toast(night?'🌙 Night mode':'☀ Day mode');
});
document.getElementById('mute-btn').addEventListener('click', function(){
  Audio_.init();
  AppState.sfxOn = !AppState.sfxOn;
  Audio_.setSfx(AppState.sfxOn);
  saveAudioPrefs();
  this.textContent = AppState.sfxOn ? '🔊' : '🔇';
  // keep the Settings panel's toggle in sync if it's currently open
  const tgS=document.getElementById('tg-sfx');
  if(tgS) tgS.classList.toggle('on', AppState.sfxOn);
});
document.getElementById('ach-btn').addEventListener('click', function(){
  currentModalView='achievements';
  const items=Object.entries(achievementsDef).map(([k,v])=>{
    const on=unlocked.has(k);
    return `<div class="item-card" style="opacity:${on?1:.45}"><div class="row"><span class="icon">${v.icon}</span><div><b>${v.name}</b><div class="sub">${v.desc}</div></div></div></div>`;
  }).join('');
  openModal(`<h2>🏆 Achievements</h2>${items}`);
});
function renderMissions(){
  const items=Object.entries(AppState.missions).map(([k,m])=>{
    const done = m.progress>=m.target;
    return `<div class="item-card"><div class="row"><div style="flex:1;"><b>${m.label}</b>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round(m.progress/m.target*100)}%"></div></div>
      <div class="sub">${m.progress}/${m.target} · reward 🪙${m.reward}</div></div>
      <button class="btn btn-sm ${m.claimed?'btn-ghost':done?'btn-primary':'btn-ghost'}" data-claim="${k}" ${(!done||m.claimed)?'disabled':''}>${m.claimed?'Claimed':'Claim'}</button>
      </div></div>`;
  }).join('');
  return `<h2>🎯 Daily Missions</h2><p class="sub">Level ${AppState.level} · ${AppState.xp} XP · 🪙${AppState.coins} coins</p>${items}`;
}
document.getElementById('mission-btn').addEventListener('click', ()=>{ currentModalView='missions'; openModal(renderMissions()); });


/* ============================================================
   SHARED: Anthropic API helper (used by Interview House, AI Agent,
   Talk House smart-replies, and the Projects Lab coding assistant)
   ============================================================ */
async function callClaude(system, messages, maxTokens){
  try{
    const res = await fetch("/api/ai", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ system, messages, max_tokens:maxTokens||500 })
    });
    const data = await res.json();
    return data.text || "Sorry, I couldn't generate a response just now.";
  }catch(err){
    return "Sorry, I couldn't reach the AI service just now. Is the server running?";
  }
}
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
/* Shared "profile picture or emoji fallback" renderer — used anywhere a
   plain, lazily-loaded avatar image is shown with no custom sizing
   (list rows, directory cards, etc). Hero/preview images that must
   render eagerly (e.g. the Profile Viewer's large photo) intentionally
   don't use this and stay written out explicitly. */
function renderAvatarHtml(entity){
  if(!entity) return '🙂';
  return entity.pic ? `<img loading="lazy" src="${entity.pic}">` : (entity.avatarEmoji || '🙂');
}
function profileSummary(){
  const u=AppState.current;
  return `Name: ${u.name}. Skills/interests: ${u.skills||'not specified'}. Bio/resume summary: ${u.bio||'not provided'}.`;
}

/* ============================================================
   BUILDING 1 — INTERVIEW HOUSE
   ============================================================ */
let interviewHistory=[]; let interviewType='HR'; let camStream=null; let recorder=null; let recChunks=[]; let micEnabled_=true;
let recTimerInterval=null; let recStartedAt=null; let recPausedElapsed=0;
function formatHHMMSS(totalSeconds){
  const h=Math.floor(totalSeconds/3600), m=Math.floor((totalSeconds%3600)/60), s=Math.floor(totalSeconds%60);
  return [h,m,s].map(n=>String(n).padStart(2,'0')).join(':');
}
// Stops camera/mic tracks and any active recording. Called whenever the
// user leaves Interview House (closes the modal, visits another building,
// or logs out) so the browser's camera/mic indicator always turns off
// promptly instead of staying on in the background.
function cleanupInterviewMedia(){
  if(recorder && recorder.state!=='inactive'){ try{ recorder.stop(); }catch(e){} }
  if(camStream){ camStream.getTracks().forEach(t=>t.stop()); camStream=null; }
  clearInterval(recTimerInterval); recTimerInterval=null;
  recorder=null;
  interviewHistory=[];
}
let nextRecordingId = 1;

function recordingButtonsHtml(){
  if(!camStream) return '';
  const state = recorder ? recorder.state : 'inactive';
  if(state==='recording') return `<button class="btn btn-ghost btn-sm" id="int-rec-pause">⏸ Pause</button><button class="btn btn-ghost btn-sm" id="int-rec-stop">⏹ Stop &amp; Save</button>`;
  if(state==='paused') return `<button class="btn btn-ghost btn-sm" id="int-rec-resume">▶ Resume</button><button class="btn btn-ghost btn-sm" id="int-rec-stop">⏹ Stop &amp; Save</button>`;
  return `<button class="btn btn-ghost btn-sm" id="int-rec">⏺ Start Recording</button>`;
}
function renderInterview(){
  const types=['HR','Technical','Behavioral','Aptitude'];
  const recording = recorder && recorder.state!=='inactive';
  return `
    <div style="display:flex;align-items:center;justify-space-between;margin-bottom:4px;">
      <h2 style="margin:0;flex:1;">🎤 Interview House</h2>
      <button class="btn btn-ghost btn-sm" id="int-clear-chat" style="color:#FF6F5E;font-size:12px;">🗑️ Clear Interview</button>
    </div>
    <p class="sub">Mock interviews personalized to your profile, with optional voice answers and camera recording.</p>
    <div class="pill-row">${types.map(t=>`<button class="pill ${t===interviewType?'active':''}" data-itype="${t}">${t}</button>`).join('')}</div>
    <div class="chat-log" id="int-log">${interviewHistory.length? interviewHistory.map(m=>`<div class="msg ${m.role==='user'?'user':'ai'}"><b>${m.role==='user'?'You':'AI Interviewer'}:</b> ${escapeHtml(m.text)}</div>`).join('') : `<div class="msg ai"><b>AI Interviewer:</b> Pick an interview type above, then hit "Start / Next Question."</div>`}</div>
    <div class="chat-row">
      <input class="inp" id="int-input" placeholder="Type your answer, or use the mic...">
      <button class="btn btn-ghost btn-sm" id="int-mic" title="Speak your answer">🎙️</button>
    </div>
    <div class="pill-row" style="margin-top:12px;">
      <button class="btn btn-primary btn-sm" id="int-next">Start / Next Question</button>
      <button class="btn btn-outline btn-sm" id="int-feedback">Get Feedback &amp; Score</button>
      <button class="btn btn-ghost btn-sm" id="int-cam">${camStream ? '🎥 Disable Camera' : '🎥 Enable Camera'}</button>
      <button class="btn btn-ghost btn-sm" id="int-mic-toggle">🎙️ Mic: On</button>
      <span id="int-rec-btns-wrap">${recordingButtonsHtml()}</span>
    </div>
    ${camStream ? `
      <div class="pill-row" style="margin-top:6px;gap:8px;">
        <button class="btn btn-primary btn-sm" id="int-photo-snap">📷 Capture Photo</button>
      </div>` : ''}
    <video class="cam" id="int-video" autoplay muted playsinline style="${camStream?'display:block;':'display:none;'}"></video>
    <div id="int-rec-status" style="display:${recording?'flex':'none'};align-items:center;gap:8px;margin-top:6px;">
      <span id="int-rec-dot" class="rec-dot ${recorder && recorder.state==='paused'?'paused':''}"></span>
      <span id="int-rec-timer">00:00:00</span>
      <span class="sub" id="int-rec-state-label">${recorder && recorder.state==='paused'?'Paused':'Recording'}</span>
    </div>
    <div id="int-feedback-box"></div>
  `;
}
function wireInterview(){
  document.querySelectorAll('[data-itype]').forEach(b=>b.addEventListener('click', ()=>{ interviewType=b.dataset.itype; openModal(renderInterview()); }));
  
  async function triggerAIInterviewer(){
    const nextBtn=document.getElementById('int-next');
    if(nextBtn){ nextBtn.disabled=true; nextBtn.textContent='Thinking...'; }
    const sys=`You are a professional ${interviewType} interviewer for a job candidate. Candidate profile — ${profileSummary()}. Ask exactly ONE realistic, concise ${interviewType.toLowerCase()} interview question, appropriate to their skills. Do not number it, do not add preamble.`;
    const msgs = interviewHistory.map(m=>({role:m.role, content:m.text}));
    const q = await callClaude(sys, msgs, 150);
    interviewHistory.push({role:'assistant', text:q});
    unlockAchievement('interview');
    openModal(renderInterview());
  }

  const nextBtn=document.getElementById('int-next');
  if(nextBtn) nextBtn.addEventListener('click', triggerAIInterviewer);

  const clearBtn = document.getElementById('int-clear-chat');
  if(clearBtn) clearBtn.addEventListener('click', ()=>{
    openModal(`
      <h2>🗑️ Clear Interview</h2>
      <p class="sub">Are you sure you want to clear previous interview chats?</p>
      <div class="btn-row" style="margin-top:14px;gap:8px;">
        <button class="btn btn-primary btn-sm" id="clear-int-yes">Yes</button>
        <button class="btn btn-ghost btn-sm" id="clear-int-cancel">Cancel</button>
      </div>
    `);
    document.getElementById('clear-int-yes').addEventListener('click', ()=>{
      interviewHistory = [];
      saveUserData();
      toast('🗑️ Interview history cleared.');
      openModal(renderInterview());
    });
    document.getElementById('clear-int-cancel').addEventListener('click', ()=>{
      openModal(renderInterview());
    });
  });

  function captureInterviewPhoto(){
    const video = document.getElementById('int-video');
    if(!video || !camStream) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  const photoSnapBtn = document.getElementById('int-photo-snap');
  if(photoSnapBtn) photoSnapBtn.addEventListener('click', ()=>{
    const dataUrl = captureInterviewPhoto();
    if(!dataUrl){ toast('🎥 Camera video feed not available.'); return; }
    
    // Automatically save photo to Result House -> Recordings -> Photos
    if(!AppState.photos) AppState.photos = [];
    AppState.photos.unshift({
      id: Date.now(),
      dataUrl,
      date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString()
    });
    saveUserData();

    openModal(`
      <h2>📷 Photo Captured</h2>
      <p class="sub" style="color:var(--brand,#5B4FE8);font-weight:600;">✓ Photo auto-saved to Result House → Recordings → Photos</p>
      <img src="${dataUrl}" style="max-width:100%;border-radius:12px;margin:8px 0;">
      <div class="btn-row" style="margin-top:12px;gap:8px;">
        <button class="btn btn-primary btn-sm" id="snap-close-btn">Continue Interview</button>
      </div>
    `);
    document.getElementById('snap-close-btn').addEventListener('click', ()=>{ openModal(renderInterview()); });
  });

  const input=document.getElementById('int-input');
  async function submitAnswer(autoReply=false){
    if(!input) return;
    const v=input.value.trim(); if(!v) return;
    interviewHistory.push({role:'user', text:v});
    input.value='';
    progressMission('interview1', 1); addXP(8);
    if(autoReply){
      openModal(renderInterview());
      await triggerAIInterviewer();
    } else {
      openModal(renderInterview());
    }
  }

  if(input) input.addEventListener('keydown', e=>{ if(e.key==='Enter') submitAnswer(true); });

  if(camStream){
    const v=document.getElementById('int-video');
    if(v){ v.srcObject=camStream; v.style.display='block'; }
  }

  const micToggle=document.getElementById('int-mic-toggle');
  if(micToggle){
    micToggle.textContent = micEnabled_===false ? '🎙️ Mic: Off' : '🎙️ Mic: On';
    micToggle.addEventListener('click', ()=>{
      micEnabled_ = micEnabled_===false ? true : false;
      if(camStream){ camStream.getAudioTracks().forEach(t=>t.enabled = micEnabled_!==false); }
      micToggle.textContent = micEnabled_===false ? '🎙️ Mic: Off' : '🎙️ Mic: On';
      toast(micEnabled_===false ? '🎙️ Microphone muted' : '🎙️ Microphone on');
    });
  }

  const mic=document.getElementById('int-mic');
  if(mic){
    const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
    mic.addEventListener('click', ()=>{
      if(mic.disabled) return;
      if(!SR){ toast('🎙️ Speech recognition is not supported in this browser.'); return; }
      mic.disabled=true; mic.classList.add('listening'); mic.textContent='●';
      const rec = new SR(); rec.lang='en-US'; rec.interimResults=false;
      toast('🎙️ Listening...');
      rec.onresult = e=>{
        const transcript = e.results[0][0].transcript;
        const inputEl = document.getElementById('int-input');
        if(inputEl) inputEl.value = transcript;
        submitAnswer(true);
      };
      rec.onerror = ()=>{ toast('Could not capture audio — check microphone permission.'); };
      rec.onend = ()=>{ mic.classList.remove('listening'); mic.textContent='🎙️'; mic.disabled=false; };
      rec.start();
    });
  }

  const fbBtn=document.getElementById('int-feedback');
  if(fbBtn) fbBtn.addEventListener('click', async ()=>{
    if(!interviewHistory.length){ toast('Answer a few questions first.'); return; }
    fbBtn.disabled=true; fbBtn.textContent='Scoring...';
    const transcript = interviewHistory.map(m=>`${m.role==='user'?'Candidate':'Interviewer'}: ${m.text}`).join('\n');
    const sys = `You are an interview coach. Score the candidate's transcript on Communication, Confidence, Technical Accuracy, and Overall Performance (each 0-100), then give 2-3 short improvement suggestions. Reply in this exact plain-text format:\nCommunication: N\nConfidence: N\nTechnical Accuracy: N\nOverall: N\nSuggestions: ...`;
    const out = await callClaude(sys, [{role:'user', content:transcript}], 300);
    const overallMatch = out.match(/Overall:\s*(\d+)/i);
    const score = overallMatch? parseInt(overallMatch[1]) : 70;
    AppState.interview.scores.push(score);
    AppState.interview.history.push({type:interviewType, score, feedback:out, date:new Date().toLocaleString(), transcript:[...interviewHistory]});
    submitScore('interview', score, 'Mock interview session');
    document.getElementById('int-feedback-box').innerHTML = `<h3>Feedback</h3><div class="item-card" style="white-space:pre-wrap;">${escapeHtml(out)}</div>`;
    fbBtn.disabled=false; fbBtn.textContent='Get Feedback & Score';
    saveUserData();
  });

  const camBtn=document.getElementById('int-cam');
  if(camBtn) camBtn.addEventListener('click', async ()=>{
    if(camStream){
      cleanupInterviewMedia();
      openModal(renderInterview());
      toast('🎥 Camera turned off');
      return;
    }
    camBtn.disabled=true; camBtn.textContent='Requesting access...';
    try{
      camStream = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
      camStream.getAudioTracks().forEach(t=>t.enabled = micEnabled_!==false);
      openModal(renderInterview());
      toast('🎥 Camera on');
    }catch(err){
      camStream=null;
      toast('Camera/microphone permission denied or unavailable on this device.');
      camBtn.disabled=false; camBtn.textContent='🎥 Enable Camera';
    }
  });

  function startRecTimer(){
    clearInterval(recTimerInterval);
    recTimerInterval = setInterval(()=>{
      if(!recorder || recorder.state==='inactive') { clearInterval(recTimerInterval); return; }
      if(recorder.state==='paused') return;
      const elapsed = recPausedElapsed + Math.floor((Date.now()-recStartedAt)/1000);
      const t=document.getElementById('int-rec-timer');
      if(t) t.textContent = formatHHMMSS(elapsed);
    }, 1000);
  }

  function startRecording(){
    if(!camStream){ toast('Turn the camera on first.'); return; }
    recChunks=[];
    recorder = new MediaRecorder(camStream);
    recorder.ondataavailable = e=>recChunks.push(e.data);
    recorder.onstop = async ()=>{
      clearInterval(recTimerInterval); recTimerInterval=null;
      const blob = new Blob(recChunks, {type:'video/webm'});
      const fd = new FormData();
      fd.append('video', blob, `recording_${Date.now()}.webm`);
      toast('⏳ Saving recording to server...');
      let url = URL.createObjectURL(blob);
      try {
        const res = await fetch('/api/recordings/upload', { method: 'POST', body: fd });
        if(res.ok) {
          const data = await res.json();
          url = data.url;
          toast('⏹ Recording saved.');
        }
      } catch(err) {
        console.error('Failed to upload recording:', err);
      }
      AppState.recordings = AppState.recordings || [];
      AppState.recordings.unshift({id: nextRecordingId++, name:`Interview — ${interviewType} — ${new Date().toLocaleString()}`, url, size:blob.size});
      saveUserData();
      Audio_.recordStop();
      updateRecordingUI();
    };
    recStartedAt = Date.now(); recPausedElapsed = 0;
    recorder.start();
    Audio_.recordStart();
    toast('⏺ Recording started');
    updateRecordingUI();
    startRecTimer();
  }

  function pauseRecording(){
    if(!recorder || recorder.state!=='recording') return;
    recorder.pause();
    recPausedElapsed += Math.floor((Date.now()-recStartedAt)/1000);
    toast('⏸ Recording paused');
    updateRecordingUI();
  }

  function resumeRecording(){
    if(!recorder || recorder.state!=='paused') return;
    recorder.resume();
    recStartedAt = Date.now();
    toast('▶ Recording resumed');
    updateRecordingUI();
    startRecTimer();
  }

  function stopRecording(){
    if(!recorder || recorder.state==='inactive') return;
    recorder.stop();
  }

  function updateRecordingUI(){
    const wrap = document.getElementById('int-rec-btns-wrap');
    if(wrap) wrap.innerHTML = recordingButtonsHtml();
    const statusBox = document.getElementById('int-rec-status');
    const recording = recorder && recorder.state!=='inactive';
    if(statusBox) statusBox.style.display = recording ? 'flex' : 'none';
    const dot = document.getElementById('int-rec-dot');
    const label = document.getElementById('int-rec-state-label');
    const paused = recorder && recorder.state==='paused';
    if(dot) dot.className = `rec-dot ${paused ? 'paused' : ''}`;
    if(label) label.textContent = paused ? 'Paused' : 'Recording';
    
    const recBtn = document.getElementById('int-rec');
    if(recBtn) recBtn.addEventListener('click', startRecording);
    const recPauseBtn = document.getElementById('int-rec-pause');
    if(recPauseBtn) recPauseBtn.addEventListener('click', pauseRecording);
    const recResumeBtn = document.getElementById('int-rec-resume');
    if(recResumeBtn) recResumeBtn.addEventListener('click', resumeRecording);
    const recStopBtn = document.getElementById('int-rec-stop');
    if(recStopBtn) recStopBtn.addEventListener('click', stopRecording);
  }

  updateRecordingUI();
  if(recorder && recorder.state==='recording') startRecTimer();
}

/* ============================================================
   BUILDING 2 — SKILLS DEVELOPMENT HOUSE
   ============================================================ */
const LEARNING_PATHS = {
  'Web Development': [
    'What does HTML stand for?|HyperText Markup Language|CSS Styling Rules|High Text Machine Language|Home Tool Markup Language|A|0|HTML expands to HyperText Markup Language, the standard language for building web pages.',
    'Which tag creates a hyperlink?|<link>|<a>|<href>|<nav>|B|1|The <a> (anchor) tag with an href attribute creates a clickable hyperlink.',
    'CSS stands for?|Colorful Style Sheets|Cascading Style Sheets|Computer Style Syntax|Creative Style System|B|1|CSS stands for Cascading Style Sheets — "cascading" refers to how rules combine and override each other.',
    'What does the Virtual DOM help with in React?|Faster UI updates by diffing changes|Storing cookies|Compiling CSS|Making HTTP requests|A|0|React uses a Virtual DOM to compute the minimal set of real DOM changes needed, making UI updates faster.',
    'Which HTTP method is typically used to submit new data to a server?|GET|POST|DELETE|HEAD|B|1|POST is conventionally used to send new data to be processed/created on the server.',
    'What is the purpose of the "box-sizing: border-box" CSS rule?|Includes padding and border in the element\'s total width/height|Removes all borders|Makes elements circular|Disables box shadows|A|0|border-box makes width/height include padding and border, avoiding surprise layout growth.',
  ],
  'Python': [
    'Which keyword defines a function?|func|define|def|function|C|2|Python functions are defined with the "def" keyword, e.g. def greet():.',
    'What is the output of type([])?|list|array|tuple|dict|A|0|An empty pair of square brackets [] creates a list, so type([]) is <class \'list\'>.',
    'Which data type is immutable in Python?|list|dict|set|tuple|D|3|Tuples are immutable — once created, their elements cannot be changed.',
    'What does the "len()" function return for a string?|The number of characters|The memory address|The ASCII sum|The first character|A|0|len() returns the count of characters (elements) in the string.',
    'How do you start a single-line comment in Python?|//|#|/* */|<!-- -->|B|1|Python uses "#" to mark the rest of a line as a comment.',
    'What does "pip" primarily do?|Compiles Python code|Installs Python packages|Formats code style|Runs unit tests|B|1|pip is Python\'s standard package installer, used to add libraries from PyPI.',
  ],
  'DSA': [
    'Which data structure uses FIFO?|Stack|Queue|Tree|Graph|B|1|A Queue is First-In-First-Out — the first element added is the first removed.',
    'Big-O of binary search?|O(n)|O(1)|O(log n)|O(n^2)|C|2|Binary search halves the search space each step, giving O(log n) time complexity.',
    'Which data structure uses LIFO?|Queue|Stack|Array|Linked List|B|1|A Stack is Last-In-First-Out — the most recently added element is removed first.',
    'What is the worst-case time complexity of Bubble Sort?|O(n log n)|O(n)|O(n^2)|O(1)|C|2|Bubble sort compares adjacent pairs repeatedly, giving O(n^2) worst-case time.',
    'A Binary Search Tree keeps left children...?|Greater than the parent|Equal to the parent|Less than the parent|Unordered|C|2|In a BST, every left child is smaller than its parent, and every right child is larger.',
    'Which structure is best for implementing recursion / undo functionality?|Stack|Queue|Hash Map|Heap|A|0|Stacks naturally model "last action first undone" behavior, which is why call stacks and undo features use them.',
  ],
  'AI/ML': [
    'Supervised learning uses?|Unlabeled data|Labeled data|No data|Random data|B|1|Supervised learning trains a model on labeled input-output pairs.',
    'Which is NOT a common ML algorithm?|Linear Regression|Random Forest|HTTP Server|K-Means|C|2|An HTTP Server is a networking component, not a machine learning algorithm.',
    'What does "overfitting" mean?|Model performs well on training data but poorly on new data|Model is too simple|Model trains too fast|Model has no parameters|A|0|Overfitting happens when a model memorizes training data patterns that don\'t generalize to new data.',
    'What is a "neural network" loosely inspired by?|Computer chips|The human brain|Spreadsheets|Databases|B|1|Neural networks are loosely inspired by interconnected neurons in biological brains.',
    'Which technique reduces overfitting?|Adding more parameters only|Regularization|Removing all training data|Increasing learning rate infinitely|B|1|Regularization techniques (like L1/L2, dropout) penalize complexity to reduce overfitting.',
  ],
  'Cloud': [
    'IaaS stands for?|Infra as a Service|Internet as a Service|Instance as a Service|Info as a Service|A|0|IaaS (Infrastructure as a Service) provides virtualized computing resources over the internet.',
    'Which is a major cloud provider?|AWS|MySQL|React|Figma|A|0|Amazon Web Services (AWS) is one of the major cloud computing providers.',
    'What does "auto-scaling" do in the cloud?|Automatically adjusts resources based on demand|Deletes unused accounts|Encrypts all traffic|Formats storage disks|A|0|Auto-scaling automatically adds or removes compute resources to match current demand.',
    'What is a key benefit of serverless computing?|You manage the OS yourself|No need to provision or manage servers|It only runs on-premises|It requires manual scaling|B|1|Serverless computing lets you run code without provisioning or managing the underlying servers.',
    'Which cloud model gives you the most control over the OS?|SaaS|PaaS|IaaS|FaaS|C|2|IaaS gives the most control, including access to the virtual machine\'s operating system.',
  ],
  'Java': [
    'Which keyword creates a new object?|make|new|create|object|B|1|Java uses the "new" keyword to allocate and construct a new object instance.',
    'Java is primarily a...?|Compiled-only language|Interpreted-only language|Compiled to bytecode, run on JVM|Markup language|C|2|Java compiles to bytecode which then runs on the Java Virtual Machine (JVM), making it portable.',
    'Which keyword is used to inherit a class in Java?|implements|extends|inherits|super|B|1|A class uses "extends" to inherit from another class in Java.',
    'What is the default value of a boolean instance variable?|true|false|null|0|B|1|Uninitialized boolean instance variables default to false in Java.',
    'Which collection type does not allow duplicate elements?|ArrayList|LinkedList|HashSet|Stack|C|2|A Set (like HashSet) enforces uniqueness — duplicate elements are not stored.',
  ],
  'Data Science': [
    'Which library is popular for dataframes in Python?|pandas|express|django|jquery|A|0|pandas is the go-to Python library for tabular data manipulation via DataFrames.',
    'What does "EDA" stand for?|Extra Data Analysis|Exploratory Data Analysis|External Data API|Encoded Data Array|B|1|EDA (Exploratory Data Analysis) is the process of summarizing and visualizing data to find patterns.',
    'Which chart is best for showing the distribution of a single numeric variable?|Histogram|Pie chart|Scatter plot|Line chart|A|0|A histogram groups values into bins, making it ideal for visualizing a single variable\'s distribution.',
    'What does "null" or "NaN" typically represent in a dataset?|A very large number|Missing or undefined data|The average value|A duplicate row|B|1|NaN/null represents missing or undefined values that often need to be handled before analysis.',
    'Which metric measures the average squared difference between predicted and actual values?|Accuracy|Mean Squared Error (MSE)|Precision|F1 Score|B|1|MSE averages the squared errors between predictions and actual values — commonly used for regression.',
  ],
};
function renderSkills(){
  const paths=Object.keys(LEARNING_PATHS);
  const cards=paths.map(p=>{
    const done=AppState.quiz.completed[p];
    return `<div class="item-card click" data-path="${p}"><div class="row"><span class="icon">📘</span><div style="flex:1;"><b>${p}</b><div class="sub">${LEARNING_PATHS[p].length} quiz questions · roadmap, notes &amp; badges</div></div>${done? `<span class="tag">✅ ${done}%</span>`:''}</div></div>`;
  }).join('');
  return `
    <h2>📚 Skills Development House</h2>
    <p class="sub">Pick a learning path to see the roadmap and take the quiz. Daily streak: <b>${AppState.quiz.streak}</b> 🔥</p>
    ${cards}
  `;
}
function shuffleArr(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
let currentQuizSession = null; // {path, questions:[{q,opts,correctIndex,explanation}]}
function renderQuiz(path){
  const raw = LEARNING_PATHS[path];
  const parsed = raw.map(line=>{
    const [q,a,b,c,d,letter,ciStr,explanation]=line.split('|');
    const opts=[a,b,c,d];
    const correctText = opts[parseInt(ciStr)];
    const shuffledOpts = shuffleArr(opts);
    return { q, opts: shuffledOpts, correctIndex: shuffledOpts.indexOf(correctText), explanation };
  });
  currentQuizSession = { path, questions: shuffleArr(parsed) };
  const qs = currentQuizSession.questions;
  return `
    <h2>📘 ${path} — Quiz</h2>
    <p class="sub">${qs.length} questions · randomized order · minimum 5 required ✅</p>
    <form id="quiz-form">
      ${qs.map((item,i)=>`<div class="item-card"><b>${i+1}. ${escapeHtml(item.q)}</b>${item.opts.map((o,oi)=>`<div style="margin-top:6px;"><label><input type="radio" name="q${i}" value="${oi}"> ${escapeHtml(o)}</label></div>`).join('')}</div>`).join('')}
      <button type="button" class="btn btn-primary" id="quiz-submit">Submit Quiz</button>
    </form>
    <div id="quiz-result"></div>
  `;
}
function wireSkills(){
  document.querySelectorAll('[data-path]').forEach(c=>c.addEventListener('click', ()=>{
    openModal(renderQuiz(c.dataset.path));
  }));
  const submitBtn=document.getElementById('quiz-submit');
  if(submitBtn) submitBtn.addEventListener('click', ()=>{
    if(!currentQuizSession) return;
    const { path, questions } = currentQuizSession;
    let correctCount=0;
    const breakdown = questions.map((item,i)=>{
      const sel = document.querySelector(`input[name="q${i}"]:checked`);
      const selIndex = sel ? parseInt(sel.value) : -1;
      const isCorrect = selIndex===item.correctIndex;
      if(isCorrect) correctCount++;
      const letters=['A','B','C','D'];
      return {i, isCorrect, correctLetter: letters[item.correctIndex], correctText: item.opts[item.correctIndex], explanation: item.explanation, question:item.q};
    });
    const pct = Math.round(correctCount/questions.length*100);
    AppState.quiz.completed[path]=pct;
    AppState.quiz.streak++;

    if(!AppState.quiz.history) AppState.quiz.history = [];
    AppState.quiz.history.unshift({
      id: Date.now(),
      date: new Date().toLocaleString(),
      path,
      pct,
      correctCount,
      totalCount: questions.length,
      breakdown
    });

    saveUserData();
    unlockAchievement('quiz');
    progressMission('quiz1', 1); addXP(20);
    submitScore('skills', pct, path+' quiz');
    const wrong = questions.length - correctCount;
    document.getElementById('quiz-result').innerHTML = `
      <div class="item-card"><b>Score: ${correctCount}/${questions.length} (${pct}%)</b>
        <div class="sub">✅ Correct: ${correctCount} &nbsp; ❌ Wrong: ${wrong} &nbsp;·&nbsp; Progress saved to your Results dashboard.</div>
      </div>
      <h3>Answer Review</h3>
      ${breakdown.map(b=>`<div class="item-card" style="border-left:4px solid ${b.isCorrect?'#1FBFA0':'#FF6F5E'};">
        <b>Q${b.i+1}. ${escapeHtml(b.question)}</b>
        <div class="sub">${b.isCorrect?'✅ You got it right':'❌ You missed this one'} — Correct Answer: ${b.correctLetter}) ${escapeHtml(b.correctText)}</div>
        <div class="sub" style="margin-top:4px;">Explanation: ${escapeHtml(b.explanation||'')}</div>
      </div>`).join('')}
    `;
  });
}

/* ============================================================
   BUILDING 3 — PROJECTS LAB
   ============================================================ */
const STARTER_CODE = {
  javascript: "console.log('Hello from S2 Talk!');",
  python: "print('Hello')\n# Try: name = input('Enter Name:')\n# print(name)",
  c: "#include <stdio.h>\nint main(){\n  printf(\"Hello\\n\");\n  return 0;\n}",
  cpp: "#include <iostream>\nusing namespace std;\nint main(){\n  cout << \"Hello\" << endl;\n  return 0;\n}",
  html: "<!DOCTYPE html>\n<html>\n<head>\n  <style>\n    body { font-family: sans-serif; background: #1a1b35; color: #fff; text-align: center; padding: 30px; }\n    h1 { color: #5B4FE8; }\n    button { padding: 10px 20px; background: #1FBFA0; border: none; color: white; border-radius: 8px; cursor: pointer; font-weight: bold; }\n  </style>\n</head>\n<body>\n  <h1>Hello from S2 Talk!</h1>\n  <button onclick=\"alert('Interactive HTML/CSS Preview Works!')\">Click Me</button>\n</body>\n</html>"
};
let labLang='javascript';
let labCodeDraft = null;
let labStdinDraft = '';
let nextProjectId = 1;
let editingProjectId = null;
let importedProjectOriginalName = null;
let labTerminalSessionOutput = null;

function hasInputStatement(lang, code){
  if(!code) return false;
  if(lang === 'python' || lang === 'py'){
    return /\binput\s*\(/.test(code);
  }
  if(lang === 'c'){
    return /\bscanf\s*\(/.test(code) || /\bgets\s*\(/.test(code) || /\bfgets\s*\(/.test(code);
  }
  if(lang === 'cpp'){
    return /\bcin\s*>>/.test(code) || /\bscanf\s*\(/.test(code) || /\bgetline\s*\(/.test(code);
  }
  if(lang === 'javascript' || lang === 'js'){
    return /\bprompt\s*\(/.test(code);
  }
  return false;
}

let labProjectsMultiSelect = false;
let labProjectsSelected = new Set();

function getLabDraft(lang){
  try {
    const uid = AppState.current ? AppState.current.uid : null;
    const key = uid ? 's2talk_lab_draft_' + uid + '_' + lang : 's2talk_lab_draft_' + lang;
    return localStorage.getItem(key);
  } catch(e){ return null; }
}
function saveLabDraft(lang, code){
  try {
    const uid = AppState.current ? AppState.current.uid : null;
    const draftKey = uid ? 's2talk_lab_draft_' + uid + '_' + lang : 's2talk_lab_draft_' + lang;
    const langKey = uid ? 's2talk_lab_active_lang_' + uid : 's2talk_lab_active_lang';
    localStorage.setItem(draftKey, code);
    localStorage.setItem(langKey, lang);
  } catch(e){}
}
function getActiveLabLang(){
  try {
    const uid = AppState.current ? AppState.current.uid : null;
    const key = uid ? 's2talk_lab_active_lang_' + uid : 's2talk_lab_active_lang';
    return localStorage.getItem(key) || 'python';
  } catch(e){ return 'python'; }
}

function renderLab(){
  if(!labLang) labLang = getActiveLabLang();
  const currentDraft = labCodeDraft ?? getLabDraft(labLang) ?? STARTER_CODE[labLang];
  const initialTerminalContent = labTerminalSessionOutput || 'Output will appear here...';

  return `
    <h2>💻 Projects Lab</h2>
    <p class="sub">Write, run, and save code. Supports JavaScript, Python, C, C++, and HTML/CSS Preview.</p>
    <div class="pill-row">
      ${Object.keys(STARTER_CODE).map(l=>`<button class="pill ${l===labLang?'active':''}" data-lang="${l}">${l.toUpperCase()}</button>`).join('')}
    </div>
    
    <div style="margin-top:8px;">
      <div class="sub" style="font-weight:700;margin-bottom:4px;color:var(--text);">Code Editor</div>
      <textarea class="ta" id="lab-code" rows="8" style="font-family:var(--font-mono);">${currentDraft}</textarea>
    </div>

    ${labLang!=='javascript' && labLang!=='html' ? `
    <div style="margin-top:8px;">
      <div class="sub" style="font-weight:700;margin-bottom:4px;color:var(--text);">Program Input (stdin)${hasInputStatement(labLang, currentDraft) ? ' — required by this code' : ' — optional'}</div>
      <textarea class="ta" id="lab-stdin" rows="2" style="font-family:var(--font-mono);" placeholder="One value per line, in the order your program reads them (scanf / cin / input)...">${labStdinDraft || ''}</textarea>
    </div>` : ''}

    <div class="pill-row" style="margin-top:8px;align-items:center;">
      <button class="btn btn-primary btn-sm" id="lab-run">▶ Run</button>
      <button class="btn btn-outline btn-sm" id="lab-explain">🤖 Ask AI to Explain/Fix</button>
      <button class="btn btn-ghost btn-sm" id="lab-save">💾 Save Project</button>
      <button class="btn btn-ghost btn-sm" id="lab-clear" style="color:#FF6F5E;margin-left:auto;">🗑️ Clear Editor</button>
    </div>

    <div style="margin-top:12px;">
      <div class="sub" style="font-weight:700;margin-bottom:4px;color:var(--text);">Output Console</div>
      <div id="lab-output-wrap">
        <div id="lab-terminal" class="codebox" style="display:block;white-space:pre;overflow-x:auto !important;overflow-y:auto !important;word-break:normal;min-height:110px;max-height:280px;background:#0d1117;color:#c9d1d9;padding:12px;font-family:var(--font-mono);font-size:13px;border-radius:8px;line-height:1.5;box-shadow:inset 0 0 10px rgba(0,0,0,0.5);cursor:text;">${initialTerminalContent}</div>
      </div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:16px;margin-bottom:8px;">
      <h3 style="margin:0;">My Saved Projects (${AppState.projects.length})</h3>
      ${AppState.projects.length ? `
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="btn btn-sm ${labProjectsMultiSelect?'btn-primary':'btn-outline'}" id="projects-select-toggle">
            ${labProjectsMultiSelect ? '✓ Cancel' : '[Select]'}
          </button>
          ${labProjectsMultiSelect ? `<button class="btn btn-sm" style="background:#FF6F5E;color:#fff;" id="projects-delete-selected" ${labProjectsSelected.size?'':'disabled'}>🗑️ Delete Selected (${labProjectsSelected.size})</button>` : ''}
        </div>
      ` : ''}
    </div>

    ${AppState.projects.map(p => {
      const isChecked = labProjectsSelected.has(p.id);
      return `
        <div class="item-card project-card">
          <div class="row" style="align-items:center;">
            ${labProjectsMultiSelect ? `
              <input type="checkbox" class="proj-checkbox" data-select-project="${p.id}" ${isChecked?'checked':''} style="width:18px;height:18px;margin-right:10px;cursor:pointer;">
            ` : ''}
            <div style="flex:1;"><b>${escapeHtml(p.name)}</b><div class="sub">${(p.lang||'javascript').toUpperCase()}</div></div>
            ${!labProjectsMultiSelect ? `
              <div class="dot-menu-wrap">
                <button class="btn btn-ghost btn-sm dot-menu-btn" data-menu="${p.id}">⋮</button>
                <div class="dot-menu" id="menu-${p.id}" style="display:none;">
                  <button data-edit="${p.id}">👁️ View / Edit</button>
                  <button data-rename="${p.id}">🏷️ Rename</button>
                  <button data-delete-project="${p.id}" style="color:#FF6F5E;">🗑️ Delete</button>
                </div>
              </div>
            ` : ''}
          </div>
        </div>`;
    }).join('') || '<p class="sub">No projects saved yet.</p>'}
  `;
}

async function executeCodeEngine(code){
  const outWrap = document.getElementById('lab-output-wrap');
  if(!outWrap) return;

  if(labLang === 'html'){
    outWrap.innerHTML = `<iframe id="lab-preview-frame" style="width:100%;height:240px;border:1px solid var(--border);border-radius:8px;background:#fff;"></iframe>`;
    const iframe = document.getElementById('lab-preview-frame');
    if(iframe){
      const doc = iframe.contentWindow.document;
      doc.open(); doc.write(code); doc.close();
    }
    return;
  }

  outWrap.innerHTML = `<div id="lab-terminal" class="codebox" style="display:block;white-space:pre;overflow-x:auto !important;overflow-y:auto !important;word-break:normal;min-height:110px;max-height:280px;background:#0d1117;color:#c9d1d9;padding:12px;font-family:var(--font-mono);font-size:13px;border-radius:8px;line-height:1.5;box-shadow:inset 0 0 10px rgba(0,0,0,0.5);cursor:text;"><span style="color:#8b949e;">Running...</span></div>`;
  const term = document.getElementById('lab-terminal');
  labTerminalSessionOutput = '';

  if(labLang === 'javascript'){
    await runJavaScriptInTerminal(code, term);
  } else {
    const seedInputs = (labStdinDraft || '').split('\n').filter(l => l.length > 0);
    await runBackendLanguageInTerminal(code, term, seedInputs);
  }
}

async function runJavaScriptInTerminal(code, term){
  term.innerHTML = '';

  function printToTerm(text, isErr=false){
    const span = document.createElement('span');
    if(isErr) span.style.color = '#ff7b72';
    span.textContent = text + (text.endsWith('\n') ? '' : '\n');
    term.appendChild(span);
    term.scrollTop = term.scrollHeight;
    labTerminalSessionOutput = term.innerHTML;
  }

  window.__termPrompt = (msg) => {
    return new Promise((resolve) => {
      const promptText = msg !== undefined ? String(msg) : 'Input: ';
      const promptSpan = document.createElement('span');
      promptSpan.textContent = promptText;
      term.appendChild(promptSpan);

      const inputSpan = document.createElement('span');
      inputSpan.contentEditable = 'true';
      inputSpan.style.outline = 'none';
      inputSpan.style.color = '#58a6ff';
      inputSpan.style.fontWeight = 'bold';
      inputSpan.style.minWidth = '12px';
      inputSpan.style.display = 'inline-block';
      inputSpan.style.borderBottom = '1px solid #58a6ff';
      term.appendChild(inputSpan);
      
      term.scrollTop = term.scrollHeight;
      setTimeout(() => inputSpan.focus(), 10);

      inputSpan.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if(typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        if(e.key === 'Enter'){
          e.preventDefault();
          const val = inputSpan.textContent || '';
          inputSpan.contentEditable = 'false';
          inputSpan.style.borderBottom = 'none';
          term.appendChild(document.createTextNode('\n'));
          term.scrollTop = term.scrollHeight;
          labTerminalSessionOutput = term.innerHTML;
          resolve(val);
        }
      });
    });
  };

  let transformed = code.replace(/\bprompt\s*\(/g, 'await window.__termPrompt(');
  transformed = transformed.replace(/\balert\s*\(/g, 'window.alert(');
  transformed = `(async () => {\n${transformed}\n})()`;

  const origLog = console.log;
  const origAlert = window.alert;

  console.log = (...args) => {
    const msg = args.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ');
    printToTerm(msg);
  };

  window.alert = (msg) => {
    printToTerm(String(msg));
  };

  try {
    await eval(transformed);
    if(!term.hasChildNodes()){
      printToTerm('(No Output)');
    }
  } catch(err) {
    printToTerm('Error: ' + err.message, true);
  } finally {
    console.log = origLog;
    window.alert = origAlert;
    labTerminalSessionOutput = term.innerHTML;
  }
}


async function runBackendLanguageInTerminal(code, term, currentInputs = []){
  try {
    const res = await fetch('/api/run-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: labLang, code: code, input: currentInputs.join('\n') })
    });
    if(!res.ok){
      term.innerHTML = `<span style="color:#ff7b72;">Execution error or backend server unavailable.</span>`;
      labTerminalSessionOutput = term.innerHTML;
      return;
    }
    const data = await res.json();
    const rawOut = data.output || '(No Output)';

    term.innerHTML = '';
    const outSpan = document.createElement('span');
    outSpan.textContent = rawOut;
    term.appendChild(outSpan);

    if(data.need_input){
      const inputSpan = document.createElement('span');
      inputSpan.contentEditable = 'true';
      inputSpan.style.outline = 'none';
      inputSpan.style.color = '#58a6ff';
      inputSpan.style.fontWeight = 'bold';
      inputSpan.style.minWidth = '12px';
      inputSpan.style.display = 'inline-block';
      inputSpan.style.borderBottom = '1px solid #58a6ff';
      term.appendChild(inputSpan);
      
      term.scrollTop = term.scrollHeight;
      setTimeout(() => inputSpan.focus(), 10);

      inputSpan.addEventListener('keydown', async (e) => {
        e.stopPropagation();
        if(typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        if(e.key === 'Enter'){
          e.preventDefault();
          const val = inputSpan.textContent || '';
          inputSpan.contentEditable = 'false';
          inputSpan.style.borderBottom = 'none';
          
          currentInputs.push(val);
          await runBackendLanguageInTerminal(code, term, currentInputs);
        }
      });
    } else {
      term.scrollTop = term.scrollHeight;
    }
    labTerminalSessionOutput = term.innerHTML;
  } catch(err) {
    term.innerHTML = `<span style="color:#ff7b72;">Execution error: ${escapeHtml(err.message)}</span>`;
    labTerminalSessionOutput = term.innerHTML;
  }
}

function wireLab(){
  document.querySelectorAll('[data-lang]').forEach(b=>b.addEventListener('click', ()=>{
    labLang=b.dataset.lang;
    labCodeDraft = getLabDraft(labLang) ?? STARTER_CODE[labLang];
    saveLabDraft(labLang, labCodeDraft);
    editingProjectId = null;
    openModal(renderLab());
  }));
  const codeArea=document.getElementById('lab-code');
  if(codeArea){
    codeArea.addEventListener('keydown', (e)=>{
      e.stopPropagation();
      if(typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    });
    codeArea.addEventListener('input', ()=>{
      labCodeDraft = codeArea.value;
      saveLabDraft(labLang, codeArea.value);
      saveUserDataDebounced();
    });
  }
  const stdinArea=document.getElementById('lab-stdin');
  if(stdinArea){
    stdinArea.addEventListener('keydown', (e)=>{
      e.stopPropagation();
      if(typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    });
    stdinArea.addEventListener('input', ()=>{ labStdinDraft = stdinArea.value; saveUserDataDebounced(); });
  }

  const clearBtn = document.getElementById('lab-clear');
  if(clearBtn){
    clearBtn.addEventListener('click', ()=>{
      openModal(`
        <h2>🗑️ Clear Editor</h2>
        <p class="sub">Are you sure you want to clear the editor?</p>
        <p style="font-size:13px;color:var(--text-sub);">This will erase the code in the editor, clear the output console, and remove auto-saved draft progress for <b>${labLang.toUpperCase()}</b>.</p>
        <div class="btn-row" style="margin-top:16px;gap:8px;">
          <button class="btn btn-primary btn-sm" style="background:#FF6F5E;border-color:#FF6F5E;" id="confirm-clear-yes">Yes, Clear All</button>
          <button class="btn btn-ghost btn-sm" id="confirm-clear-no">Cancel</button>
        </div>
      `);
      document.getElementById('confirm-clear-yes')?.addEventListener('click', ()=>{
        labCodeDraft = '';
        saveLabDraft(labLang, '');
        labTerminalSessionOutput = '';
        saveUserData();
        toast('🗑️ Editor and terminal output cleared.');
        openModal(renderLab());
      });
      document.getElementById('confirm-clear-no')?.addEventListener('click', ()=>{
        openModal(renderLab());
      });
    });
  }

  const runBtn=document.getElementById('lab-run');
  if(runBtn) runBtn.addEventListener('click', async ()=>{
    const code = (document.getElementById('lab-code')||{}).value || '';
    if(!code.trim()) return;
    if((labLang==='c' || labLang==='cpp') && hasInputStatement(labLang, code) && !(labStdinDraft||'').trim()){
      toast('⚠️ This program reads input — fill in Program Input (stdin) above first.');
    }

    unlockAchievement('coder');
    progressMission('code1', 1); addXP(10);
    executeCodeEngine(code);
  });



  const explainBtn=document.getElementById('lab-explain');
  if(explainBtn) explainBtn.addEventListener('click', async ()=>{
    explainBtn.disabled=true; explainBtn.textContent='Thinking...';
    const code=document.getElementById('lab-code').value;
    const sys='You are a concise coding assistant. Explain what this code does in 1-2 sentences, then list any bugs or improvements as short bullets.';
    const out = await callClaude(sys, [{role:'user', content: code}], 300);
    const formatted = String(out).replace(/\\n/g, '\n');
    const outWrap = document.getElementById('lab-output-wrap');
    if(outWrap) outWrap.innerHTML = `<div id="lab-terminal" class="codebox" style="display:block;white-space:pre-wrap;word-break:break-all;min-height:110px;max-height:280px;overflow-y:auto;background:#0d1117;color:#c9d1d9;padding:12px;font-family:var(--font-mono);font-size:13px;border-radius:8px;line-height:1.5;">${escapeHtml(formatted)}</div>`;
    explainBtn.disabled=false; explainBtn.textContent='🤖 Ask AI to Explain/Fix';
  });

  const saveBtn=document.getElementById('lab-save');
  if(saveBtn) saveBtn.addEventListener('click', ()=>{
    const code=document.getElementById('lab-code').value;
    const curProj = editingProjectId ? AppState.projects.find(x=>x.id===editingProjectId) : null;
    const baseDefaultName = importedProjectOriginalName ? (importedProjectOriginalName + '_edited') : `Project ${AppState.projects.length+1}`;
    const defaultName = curProj ? curProj.name : baseDefaultName;

    if(curProj){
      openModal(`
        <h2>💾 Save Project</h2>
        <p class="sub">You are editing "${escapeHtml(curProj.name)}".</p>
        <div class="field"><label>Project Name</label><input class="inp" id="save-proj-name" value="${escapeHtml(curProj.name)}"></div>
        <div class="btn-row" style="margin-top:14px;gap:8px;">
          <button class="btn btn-primary btn-sm" id="save-proj-update">Save (Update Existing Project)</button>
          <button class="btn btn-outline btn-sm" id="save-proj-copy">Save As (Create New Copy)</button>
          <button class="btn btn-ghost btn-sm" id="save-proj-cancel">Cancel</button>
        </div>
      `);
      const nameInput=document.getElementById('save-proj-name');
      nameInput.focus(); nameInput.select();

      document.getElementById('save-proj-update').addEventListener('click', ()=>{
        const name = nameInput.value.trim() || curProj.name;
        curProj.name = name; curProj.lang = labLang; curProj.code = code;
        saveUserData(); toast('💾 Project updated.'); openModal(renderLab());
      });

      document.getElementById('save-proj-copy').addEventListener('click', ()=>{
        const name = (nameInput.value.trim() || curProj.name) + ' (Copy)';
        AppState.projects.push({id: nextProjectId++, name, lang:labLang, code});
        saveUserData(); toast('💾 Saved as new copy.'); openModal(renderLab());
      });

      document.getElementById('save-proj-cancel').addEventListener('click', ()=>{ openModal(renderLab()); });
    } else {
      openModal(`
        <h2>💾 Save Project</h2>
        <div class="field"><label>Project Name</label><input class="inp" id="save-proj-name" placeholder="e.g. My Calculator" value="${escapeHtml(defaultName)}"></div>
        <div class="btn-row" style="margin-top:12px;">
          <button class="btn btn-primary btn-sm" id="save-proj-confirm">Save</button>
          <button class="btn btn-ghost btn-sm" id="save-proj-cancel">Cancel</button>
        </div>
      `);
      const nameInput=document.getElementById('save-proj-name');
      nameInput.focus(); nameInput.select();
      document.getElementById('save-proj-confirm').addEventListener('click', ()=>{
        const name = nameInput.value.trim() || defaultName;
        AppState.projects.push({id: nextProjectId++, name, lang:labLang, code});
        importedProjectOriginalName = null;
        saveUserData(); toast('💾 Project saved.'); openModal(renderLab());
      });
      document.getElementById('save-proj-cancel').addEventListener('click', ()=>{ openModal(renderLab()); });
      nameInput.addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('save-proj-confirm').click(); });
    }
  });

  const selectToggle = document.getElementById('projects-select-toggle');
  if(selectToggle){
    selectToggle.addEventListener('click', ()=>{
      labProjectsMultiSelect = !labProjectsMultiSelect;
      labProjectsSelected = new Set();
      openModal(renderLab());
    });
  }

  document.querySelectorAll('[data-select-project]').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const id = parseInt(cb.dataset.selectProject);
      if(cb.checked) labProjectsSelected.add(id); else labProjectsSelected.delete(id);
      const delBtn = document.getElementById('projects-delete-selected');
      if(delBtn){
        delBtn.disabled = labProjectsSelected.size === 0;
        delBtn.textContent = `🗑️ Delete Selected (${labProjectsSelected.size})`;
      }
    });
  });

  const deleteSelectedBtn = document.getElementById('projects-delete-selected');
  if(deleteSelectedBtn){
    deleteSelectedBtn.addEventListener('click', ()=>{
      if(!labProjectsSelected.size) return;
      window.showCustomConfirm('Delete Projects', `Delete ${labProjectsSelected.size} selected project(s)?`, 'Projects Deleted', () => {
        AppState.projects = AppState.projects.filter(p => !labProjectsSelected.has(p.id));
        labProjectsSelected = new Set();
        saveUserData();
        openModal(renderLab());
      });
    });
  }

  document.querySelectorAll('[data-menu]').forEach(btn=>btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    document.querySelectorAll('.dot-menu').forEach(m=>{ if(m.id!=='menu-'+btn.dataset.menu) m.style.display='none'; });
    const menu=document.getElementById('menu-'+btn.dataset.menu);
    if(menu) menu.style.display = menu.style.display==='none' ? 'block' : 'none';
  }));
  document.addEventListener('click', ()=>document.querySelectorAll('.dot-menu').forEach(m=>m.style.display='none'), {once:true});

  document.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click', ()=>{
    const p = AppState.projects.find(x=>x.id==b.dataset.edit);
    if(!p) return;
    labLang = p.lang; labCodeDraft = p.code;
    editingProjectId = p.id;
    openModal(renderLab());
    toast('✏️ Loaded "'+p.name+'" into the editor.');
  }));

  document.querySelectorAll('[data-rename]').forEach(b=>b.addEventListener('click', ()=>{
    const p = AppState.projects.find(x=>x.id==b.dataset.rename);
    if(!p) return;
    openModal(`
      <h2>🏷️ Rename Project</h2>
      <div class="field"><label>Project Name</label><input class="inp" id="rename-input" value="${escapeHtml(p.name)}"></div>
      <div class="btn-row" style="margin-top:12px;">
        <button class="btn btn-primary btn-sm" id="rename-confirm">Save</button>
        <button class="btn btn-ghost btn-sm" id="rename-cancel">Cancel</button>
      </div>
    `);
    const input=document.getElementById('rename-input'); input.focus(); input.select();
    document.getElementById('rename-confirm').addEventListener('click', ()=>{
      p.name = input.value.trim() || p.name;
      saveUserData(); toast('🏷️ Renamed.'); openModal(renderLab());
    });
    document.getElementById('rename-cancel').addEventListener('click', ()=>{ openModal(renderLab()); });
    input.addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('rename-confirm').click(); });
  }));

  document.querySelectorAll('[data-delete-project]').forEach(b=>b.addEventListener('click', ()=>{
    const p = AppState.projects.find(x=>x.id==b.dataset.deleteProject);
    if(!p) return;
    window.showCustomConfirm('Delete Project', `Delete "${p.name}"? This cannot be undone.`, 'Project Deleted', () => {
      AppState.projects = AppState.projects.filter(x=>x.id!==p.id);
      if(editingProjectId===p.id) editingProjectId=null;
      saveUserData(); toast('🗑️ Project deleted.'); openModal(renderLab());
    });
  }));
}

/* ============================================================
   BUILDING 4 — RESULTS HOUSE
   ============================================================ */
let resultsTab='overview';
let resultsSelectMode = false;
let resultsSelected = new Set(); // Stores keys like "interview-0", "skill-1", "rec-ID", "photo-ID", "proj-ID"

function renderExplorerItems(kind, items, viewMode, resultsSelectMode, resultsSelected){
  if(!items || !items.length){
    const emptyMsgs = {
      interviews: 'No completed interviews yet — visit Interview House and click "Get Feedback & Score."',
      skills: 'No completed skills quizzes yet — visit Skills Development House and complete a quiz.',
      recordings: 'No video recordings yet — record yourself in Interview House.',
      photos: 'No photos saved yet — use camera photo capture in Interview House.',
      projects: 'No saved projects yet — save one from Projects Lab.'
    };
    return `<p class="sub">${emptyMsgs[kind] || 'No items available.'}</p>`;
  }

  if(viewMode === 'details'){
    let tableRows = items.map((item, index) => {
      let key = `${kind}-${item.id !== undefined ? item.id : index}`;
      let name = item.name || item.type || (kind === 'photos' ? 'Interview Photo' : 'Item');
      let created = item.date || item.created_at || 'Today';
      let modified = item.time || created;
      let size = item.size ? `${(item.size/1024).toFixed(0)} KB` : (item.pct !== undefined ? `${item.pct}% Score` : (item.score !== undefined ? `${item.score}/100 Score` : 'Standard'));
      let typeStr = (kind === 'projects' ? (item.lang || 'JS') : kind).toUpperCase();
      let dblIdx = item.id !== undefined ? item.id : (kind==='interviews'? (items.length - 1 - index) : index);

      return `
        <tr data-dblclick-type="${kind}" data-dblclick-index="${dblIdx}" style="cursor:pointer;">
          ${resultsSelectMode ? `<td><input type="checkbox" data-select-result="${key}" ${resultsSelected.has(key)?'checked':''}></td>` : ''}
          <td><b>${escapeHtml(name)}</b></td>
          <td>${created}</td>
          <td>${modified}</td>
          <td>${size}</td>
          <td><span class="pill" style="font-size:10px;padding:2px 6px;">${typeStr}</span></td>
        </tr>`;
    }).join('');

    return `
      <div class="explorer-details-wrap">
        <table class="explorer-table">
          <thead>
            <tr>
              ${resultsSelectMode ? '<th style="width:30px;">Select</th>' : ''}
              <th>Name</th>
              <th>Created Date</th>
              <th>Modified Date</th>
              <th>Size / Score</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>`;
  }

  if(viewMode === 'large' || viewMode === 'medium' || viewMode === 'small'){
    const gridClass = viewMode === 'large' ? 'view-mode-grid-xlarge' : (viewMode === 'medium' ? 'view-mode-grid-large' : 'view-mode-grid-small');
    const cards = items.map((item, index) => {
      let key = `${kind}-${item.id !== undefined ? item.id : index}`;
      let icon = kind === 'photos' ? (item.dataUrl ? `<img loading="lazy" src="${item.dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;">` : '📷') : (kind === 'recordings' ? '🎥' : (kind === 'projects' ? '💾' : (kind === 'skills' ? '📘' : '🎤')));
      let name = item.name || item.type || (kind === 'photos' ? 'Photo' : 'Item');
      let sub = item.date || (item.lang ? item.lang.toUpperCase() : '');
      let dblIdx = item.id !== undefined ? item.id : (kind==='interviews'? (items.length - 1 - index) : index);

      return `
        <div class="item-card" data-dblclick-type="${kind}" data-dblclick-index="${dblIdx}" style="cursor:pointer;">
          ${resultsSelectMode ? `<input type="checkbox" data-select-result="${key}" ${resultsSelected.has(key)?'checked':''} style="margin-bottom:6px;">` : ''}
          <div class="icon">${icon}</div>
          <b style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;">${escapeHtml(name)}</b>
          <div class="sub" style="font-size:10px;">${escapeHtml(sub)}</div>
        </div>`;
    }).join('');

    return `<div class="${gridClass}">${cards}</div>`;
  }

  if(viewMode === 'preview'){
    return items.map((item, index) => {
      let key = `${kind}-${item.id !== undefined ? item.id : index}`;
      let name = item.name || item.type || (kind === 'photos' ? 'Photo' : 'Item');
      let dblIdx = item.id !== undefined ? item.id : (kind==='interviews'? (items.length - 1 - index) : index);

      let previewContent = '';
      if(kind === 'photos' && item.dataUrl){
        previewContent = `<img src="${item.dataUrl}" style="max-width:100%;max-height:180px;border-radius:8px;object-fit:cover;margin-top:6px;">`;
      } else if(kind === 'recordings' && item.url){
        previewContent = `<video controls src="${item.url}" style="max-width:100%;max-height:180px;border-radius:8px;margin-top:6px;"></video>`;
      } else if(kind === 'projects'){
        previewContent = `<div style="background:#0d1117;color:#c9d1d9;padding:8px;border-radius:6px;font-family:var(--font-mono);font-size:11px;max-height:100px;overflow:hidden;margin-top:6px;"><pre style="margin:0;">${escapeHtml((item.code||'').slice(0, 150))}${item.code && item.code.length > 150 ? '...' : ''}</pre></div>`;
      } else if(kind === 'interviews'){
        previewContent = `<div class="sub" style="margin-top:4px;color:var(--text);">Score: <b>${item.score}/100</b> · Date: ${item.date}<br>${escapeHtml((item.feedback||'').slice(0, 100))}...</div>`;
      } else if(kind === 'skills'){
        previewContent = `<div class="sub" style="margin-top:4px;color:var(--text);">Quiz: <b>${item.path}</b> · Score: <b>${item.pct}%</b> (${item.correctCount}/${item.totalCount})</div>`;
      }

      return `
        <div class="item-card" data-dblclick-type="${kind}" data-dblclick-index="${dblIdx}" style="margin-bottom:10px;cursor:pointer;">
          <div class="row" style="align-items:center;">
            ${resultsSelectMode ? `<input type="checkbox" data-select-result="${key}" ${resultsSelected.has(key)?'checked':''} style="margin-right:8px;">` : ''}
            <b>${escapeHtml(name)}</b>
          </div>
          <div class="preview-pane-box">${previewContent}</div>
        </div>`;
    }).join('');
  }

  // Default List View
  if(kind === 'interviews'){
    return items.map((r, i) => {
      const idx = items.length - 1 - i;
      const key = `interview-${idx}`;
      return `
        <div class="item-card" data-dblclick-type="interviews" data-dblclick-index="${idx}" style="cursor:pointer;"><div class="row" style="align-items:center;">
          ${resultsSelectMode ? `<input type="checkbox" data-select-result="${key}" ${resultsSelected.has(key)?'checked':''} style="width:18px;height:18px;margin-right:10px;cursor:pointer;">` : ''}
          <span class="icon">🎤</span><div style="flex:1;">
          <b>${r.type} Interview — ${r.score}/100</b><div class="sub">${r.date}</div></div>
          ${!resultsSelectMode ? `
            <div class="dot-menu-wrap">
              <button class="btn btn-ghost btn-sm dot-menu-btn" data-report-menu="${idx}">⋯</button>
              <div class="dot-menu" id="report-menu-${idx}" style="display:none;">
                <button data-view-report="${idx}">📖 View Report</button>
                <button data-download-report="${idx}">⬇ Download Report</button>
                <button data-delete-report="${idx}" style="color:#FF6F5E;">🗑️ Delete Report</button>
              </div>
            </div>
          ` : ''}
        </div></div>`;
    }).join('');
  } else if(kind === 'skills'){
    return items.map((s, idx) => {
      const key = `skill-${idx}`;
      return `
        <div class="item-card" data-dblclick-type="skills" data-dblclick-index="${idx}" style="cursor:pointer;"><div class="row" style="align-items:center;">
          ${resultsSelectMode ? `<input type="checkbox" data-select-result="${key}" ${resultsSelected.has(key)?'checked':''} style="width:18px;height:18px;margin-right:10px;cursor:pointer;">` : ''}
          <span class="icon">📘</span><div style="flex:1;">
          <b>${escapeHtml(s.path)} Quiz — ${s.pct}% Score</b><div class="sub">${s.date} · ${s.correctCount}/${s.totalCount} Correct</div></div>
          ${!resultsSelectMode ? `
            <div class="dot-menu-wrap">
              <button class="btn btn-ghost btn-sm dot-menu-btn" data-skill-menu="${s.id || idx}">⋯</button>
              <div class="dot-menu" id="skill-menu-${s.id || idx}" style="display:none;">
                <button data-view-skill-report="${idx}">📖 View Report</button>
                <button data-download-skill-report="${idx}">⬇ Download Report</button>
                <button data-delete-skill-report="${idx}" style="color:#FF6F5E;">🗑️ Delete Report</button>
              </div>
            </div>
          ` : ''}
        </div></div>`;
    }).join('');
  } else if(kind === 'recordings'){
    return items.map((r) => {
      const key = `rec-${r.id}`;
      return `
        <div class="item-card" data-dblclick-type="recordings" data-dblclick-index="${r.id}" style="cursor:pointer;"><div class="row" style="align-items:center;">
          ${resultsSelectMode ? `<input type="checkbox" data-select-result="${key}" ${resultsSelected.has(key)?'checked':''} style="width:18px;height:18px;margin-right:10px;cursor:pointer;">` : ''}
          <span class="icon">🎥</span><div style="flex:1;">
          <b>${escapeHtml(r.name)}</b><div class="sub">${(r.size/1024).toFixed(0)} KB</div></div>
          ${!resultsSelectMode ? `
            <div class="dot-menu-wrap">
              <button class="btn btn-ghost btn-sm dot-menu-btn" data-recording-menu="${r.id}">⋮</button>
              <div class="dot-menu" id="recording-menu-${r.id}" style="display:none;">
                <button data-view-recording="${r.id}">🎥 View</button>
                <a class="btn btn-sm btn-ghost" href="${r.url}" download="${r.name.replace(/[^a-z0-9]+/gi,'_')}.webm" style="color:inherit;text-decoration:none;padding:9px 10px;text-align:left;display:block;">⬇ Download</a>
                <button data-delete-recording="${r.id}" style="color:#FF6F5E;">🗑️ Delete</button>
              </div>
            </div>
          ` : ''}
        </div></div>`;
    }).join('');
  } else if(kind === 'photos'){
    return items.map((p, idx) => {
      const key = `photo-${p.id}`;
      return `
        <div class="item-card" data-dblclick-type="photos" data-dblclick-index="${p.id}" style="cursor:pointer;"><div class="row" style="align-items:center;">
          ${resultsSelectMode ? `<input type="checkbox" data-select-result="${key}" ${resultsSelected.has(key)?'checked':''} style="width:18px;height:18px;margin-right:10px;cursor:pointer;">` : ''}
          <img loading="lazy" src="${p.dataUrl}" style="width:40px;height:40px;border-radius:6px;object-fit:cover;margin-right:8px;">
          <div style="flex:1;">
            <b>Interview Photo</b><div class="sub">${p.date} ${p.time || ''}</div>
          </div>
          ${!resultsSelectMode ? `
            <div class="dot-menu-wrap">
              <button class="btn btn-ghost btn-sm dot-menu-btn" data-photo-menu="${p.id}">⋮</button>
              <div class="dot-menu" id="photo-menu-${p.id}" style="display:none;">
                <button data-view-photo="${p.id}">👁️ View</button>
                <button data-download-photo="${p.id}">⬇ Download</button>
                <button data-delete-photo="${p.id}" style="color:#FF6F5E;">🗑️ Delete</button>
              </div>
            </div>
          ` : ''}
        </div></div>`;
    }).join('');
  } else if(kind === 'projects'){
    return items.map((p) => {
      const key = `proj-${p.id}`;
      return `
        <div class="item-card" data-dblclick-type="projects" data-dblclick-index="${p.id}" style="cursor:pointer;"><div class="row" style="align-items:center;">
          ${resultsSelectMode ? `<input type="checkbox" data-select-result="${key}" ${resultsSelected.has(key)?'checked':''} style="width:18px;height:18px;margin-right:10px;cursor:pointer;">` : ''}
          <span class="icon">💾</span><div style="flex:1;">
          <b>${escapeHtml(p.name)}</b><div class="sub">${(p.lang||'javascript').toUpperCase()}</div></div>
          ${!resultsSelectMode ? `
            <div class="dot-menu-wrap">
              <button class="btn btn-ghost btn-sm dot-menu-btn" data-project-menu="${p.id}">⋯</button>
              <div class="dot-menu" id="project-menu-${p.id}" style="display:none;">
                <button data-preview-project="${p.id}">📖 Preview Project</button>
                <button data-download-project="${p.id}">⬇ Download ZIP</button>
                <button data-delete-project-result="${p.id}" style="color:#FF6F5E;">🗑️ Delete Project</button>
              </div>
            </div>
          ` : ''}
        </div></div>`;
    }).join('');
  }
}

function renderResults(){
  const mins = AppState.loginTime ? Math.max(1, Math.round((Date.now()-AppState.loginTime)/60000)) : 0;
  const avgInterview = AppState.interview.scores.length ? Math.round(AppState.interview.scores.reduce((a,b)=>a+b,0)/AppState.interview.scores.length) : 0;
  const skillsAvg = Object.values(AppState.quiz.completed).length ? Math.round(Object.values(AppState.quiz.completed).reduce((a,b)=>a+b,0)/Object.values(AppState.quiz.completed).length) : 0;
  const lb = AppState.leaderboard || [];
  const rows = lb.length
    ? lb.map((l,i)=>{
        const picHtml = renderAvatarHtml(l);
        const you = l.uid===AppState.current.uid ? ' (you)' : '';
        return `<div class="item-card"><div class="row"><span class="icon">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'▪️'}</span>
          <span style="width:28px;height:28px;border-radius:50%;overflow:hidden;background:var(--bg2);display:inline-flex;align-items:center;justify-content:center;font-size:15px;">${picHtml}</span>
          <b>${escapeHtml(l.name)}${you}</b><span style="margin-left:auto;">${l.score} pts</span></div></div>`;
      }).join('')
    : '<p class="sub">Loading leaderboard...</p>';

  if(!AppState.resultsViewModes) AppState.resultsViewModes = { interviews: 'list', skills: 'list', recordings: 'list', photos: 'large', projects: 'list' };
  const currentViewMode = AppState.resultsViewModes[resultsTab] || 'list';

  const reports = (AppState.interview.history||[]).slice().reverse();
  const reportsHtml = renderExplorerItems('interviews', reports, currentViewMode, resultsSelectMode, resultsSelected);

  const skillsHistory = AppState.quiz.history || [];
  const skillsHtml = renderExplorerItems('skills', skillsHistory, currentViewMode, resultsSelectMode, resultsSelected);

  const recs = AppState.recordings||[];
  const recsHtml = renderExplorerItems('recordings', recs, currentViewMode, resultsSelectMode, resultsSelected);

  const photos = AppState.photos||[];
  const photosHtml = renderExplorerItems('photos', photos, currentViewMode, resultsSelectMode, resultsSelected);

  const projs = AppState.projects||[];
  const projsHtml = renderExplorerItems('projects', projs, currentViewMode, resultsSelectMode, resultsSelected);

  const tabs = ['overview','interviews','skills','recordings','photos','projects','leaderboard'];
  const tabLabel = {overview:'Overview', interviews:'Interview Reports', skills:'Skills Reports', recordings:'Recordings', photos:'Photos', projects:'Projects', leaderboard:'Leaderboard'};

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <h2 style="margin:0;">📊 Results House</h2>
      ${(resultsTab !== 'leaderboard' && resultsTab !== 'overview') ? `
        <div style="display:flex;gap:6px;align-items:center;">
          <select class="inp btn-sm" id="results-view-mode-select" style="width:auto;padding:4px 8px;font-size:12px;cursor:pointer;">
            <option value="large" ${currentViewMode==='large'?'selected':''}>📷 Large Icons</option>
            <option value="medium" ${currentViewMode==='medium'?'selected':''}>🖼️ Medium Icons</option>
            <option value="small" ${currentViewMode==='small'?'selected':''}>▫️ Small Icons</option>
            <option value="list" ${currentViewMode==='list'?'selected':''}>☰ List View</option>
            <option value="details" ${currentViewMode==='details'?'selected':''}>📋 Details View</option>
            <option value="content" ${currentViewMode==='content'?'selected':''}>📄 Content View</option>
            <option value="preview" ${currentViewMode==='preview'?'selected':''}>👁️ Preview View</option>
          </select>
          <button class="btn btn-sm ${resultsSelectMode?'btn-primary':'btn-outline'}" id="results-select-toggle">
            ${resultsSelectMode ? '✓ Cancel' : '[Select]'}
          </button>
          ${resultsSelectMode ? `<button class="btn btn-sm" style="background:#FF6F5E;color:#fff;" id="results-delete-selected" ${resultsSelected.size?'':'disabled'}>🗑️ Delete Selected (${resultsSelected.size})</button>` : ''}
        </div>
      ` : ''}
    </div>

    <div class="pill-row">${tabs.map(t=>`<button class="pill ${resultsTab===t?'active':''}" data-results-tab="${t}">${tabLabel[t]}</button>`).join('')}</div>

    <div id="results-overview" style="${resultsTab==='overview'?'':'display:none;'}">
      <div class="grid2">
        <div class="stat-box"><div class="n">${mins}m</div><div class="l">Time Spent</div></div>
        <div class="stat-box"><div class="n">${avgInterview}</div><div class="l">Interview Score</div></div>
        <div class="stat-box"><div class="n">${skillsAvg}%</div><div class="l">Skills Progress</div></div>
        <div class="stat-box"><div class="n">${AppState.projects.length}</div><div class="l">Projects Completed</div></div>
        <div class="stat-box"><div class="n">${(AppState.acceptedFriends||[]).length}</div><div class="l">Friends Added</div></div>
        <div class="stat-box"><div class="n">${AppState.quiz.streak}</div><div class="l">Daily Streak</div></div>
        <div class="stat-box"><div class="n">Lv.${AppState.level}</div><div class="l">${AppState.xp} XP</div></div>
        <div class="stat-box"><div class="n">🪙${AppState.coins}</div><div class="l">Current Coins</div></div>
      </div>
      <h3>🪙 Coins</h3>
      <div class="grid2">
        <div class="stat-box"><div class="n">🪙${AppState.coinsEarned||0}</div><div class="l">Total Coins Earned</div></div>
        <div class="stat-box"><div class="n">🪙${AppState.coinsSpent||0}</div><div class="l">Total Coins Spent</div></div>
        <div class="stat-box"><div class="n">🪙${AppState.coins||0}</div><div class="l">Current Balance</div></div>
        <div class="stat-box"><div class="n">🪙${(AppState.coinsBySource||{}).level||0}</div><div class="l">Level Rewards</div></div>
        <div class="stat-box"><div class="n">🪙${(AppState.coinsBySource||{}).game||0}</div><div class="l">Game Rewards</div></div>
      </div>
    </div>
    <div id="results-interviews" style="${resultsTab==='interviews'?'':'display:none;'}margin-top:8px;">${reportsHtml}</div>
    <div id="results-skills" style="${resultsTab==='skills'?'':'display:none;'}margin-top:8px;">${skillsHtml}</div>
    <div id="results-recordings" style="${resultsTab==='recordings'?'':'display:none;'}margin-top:8px;">${recsHtml}</div>
    <div id="results-photos" style="${resultsTab==='photos'?'':'display:none;'}margin-top:8px;">${photosHtml}</div>
    <div id="results-projects" style="${resultsTab==='projects'?'':'display:none;'}margin-top:8px;">${projsHtml}</div>
    <div id="results-leaderboard" style="${resultsTab==='leaderboard'?'':'display:none;'}margin-top:8px;">
      <p class="sub">Real S2 Talk members, real scores.</p>
      <div id="leaderboard-list">${rows}</div>
    </div>
  `;
}
async function wireResults(){
  document.querySelectorAll('[data-results-tab]').forEach(b=>b.addEventListener('click', ()=>{
    resultsTab = b.dataset.resultsTab;
    resultsSelectMode = false; resultsSelected = new Set();
    saveUserData();
    openModal(renderResults());
  }));

  const viewSelect = document.getElementById('results-view-mode-select');
  if(viewSelect){
    viewSelect.addEventListener('change', ()=>{
      if(!AppState.resultsViewModes) AppState.resultsViewModes = {};
      AppState.resultsViewModes[resultsTab] = viewSelect.value;
      saveUserData();
      openModal(renderResults());
    });
  }

  document.querySelectorAll('[data-dblclick-type]').forEach(el => {
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const type = el.dataset.dblclickType;
      const idx = el.dataset.dblclickIndex;

      if(type === 'interviews'){
        const r = AppState.interview.history ? AppState.interview.history[parseInt(idx)] : null;
        if(r){
          openModal(`
            <h2>🎤 ${r.type} Interview Report</h2>
            <p class="sub">${r.date} · Score: <b>${r.score}/100</b></p>
            <div class="item-card" style="white-space:pre-wrap;text-align:left;">${escapeHtml(r.feedback)}</div>
            <h3>Transcript</h3>
            <div class="chat-log" style="text-align:left;">${(r.transcript||[]).map(m=>`<div class="msg ${m.role==='user'?'user':'ai'}"><b>${m.role==='user'?'Candidate':'AI Interviewer'}:</b> ${escapeHtml(m.text)}</div>`).join('') || '<p class="sub">No transcript saved.</p>'}</div>
            <button class="btn btn-ghost btn-sm" id="report-back" style="margin-top:12px;">← Back to Results</button>
          `);
          document.getElementById('report-back')?.addEventListener('click', ()=>{ openModal(renderResults()); });
        }
      } else if(type === 'skills'){
        const s = AppState.quiz.history ? AppState.quiz.history[parseInt(idx)] : null;
        if(s){
          openModal(`
            <h2>📘 ${escapeHtml(s.path)} Quiz Report</h2>
            <div class="stat-box" style="max-width:160px;margin:8px auto;"><div class="n">${s.pct}%</div><div class="l">Score</div></div>
            <p class="sub">${s.date} · ${s.correctCount}/${s.totalCount} Correct</p>
            <button class="btn btn-ghost btn-sm" id="skill-report-back" style="margin-top:12px;">← Back to Results</button>
          `);
          document.getElementById('skill-report-back')?.addEventListener('click', ()=>{ openModal(renderResults()); });
        }
      } else if(type === 'recordings'){
        const r = (AppState.recordings||[]).find(x => String(x.id) === String(idx));
        if(r){
          openModal(`
            <h2>🎥 ${escapeHtml(r.name)}</h2>
            <video class="cam" style="margin-top:8px;max-width:100%;" controls src="${r.url}"></video>
            <button class="btn btn-ghost btn-sm" id="rec-back" style="margin-top:12px;">← Back to Results</button>
          `);
          document.getElementById('rec-back')?.addEventListener('click', ()=>{ openModal(renderResults()); });
        }
      } else if(type === 'photos'){
        const p = (AppState.photos||[]).find(x => String(x.id) === String(idx));
        if(p){
          openModal(`
            <h2>📷 Interview Photo</h2>
            <img src="${p.dataUrl}" style="max-width:100%;border-radius:12px;margin-top:8px;">
            <button class="btn btn-ghost btn-sm" id="photo-back" style="margin-top:12px;">← Back to Results</button>
          `);
          document.getElementById('photo-back')?.addEventListener('click', ()=>{ openModal(renderResults()); });
        }
      } else if(type === 'projects'){
        const p = (AppState.projects||[]).find(x => String(x.id) === String(idx));
        if(p){
          openModal(`
            <h2>💾 ${escapeHtml(p.name)}</h2>
            <p class="sub">${(p.lang||'javascript').toUpperCase()}</p>
            <div style="background:#0d1117;color:#c9d1d9;padding:12px;border-radius:8px;font-family:var(--font-mono);font-size:12px;max-height:240px;overflow-y:auto;text-align:left;white-space:pre-wrap;">${escapeHtml(p.code||'')}</div>
            <div class="btn-row" style="margin-top:12px;gap:8px;">
              <button class="btn btn-primary btn-sm" id="open-proj-in-lab">✏️ Open in Project Lab</button>
              <button class="btn btn-ghost btn-sm" id="proj-back">← Back to Results</button>
            </div>
          `);
          document.getElementById('open-proj-in-lab')?.addEventListener('click', ()=>{
            labLang = p.lang; labCodeDraft = p.code; editingProjectId = p.id;
            openModal(renderLab());
          });
          document.getElementById('proj-back')?.addEventListener('click', ()=>{ openModal(renderResults()); });
        }
      }
    });
  });

  const selectToggle = document.getElementById('results-select-toggle');
  if(selectToggle){
    selectToggle.addEventListener('click', ()=>{
      resultsSelectMode = !resultsSelectMode;
      resultsSelected = new Set();
      openModal(renderResults());
    });
  }



  document.querySelectorAll('[data-select-result]').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const key = cb.dataset.selectResult;
      if(cb.checked) resultsSelected.add(key); else resultsSelected.delete(key);
      const delBtn = document.getElementById('results-delete-selected');
      if(delBtn){
        delBtn.disabled = resultsSelected.size === 0;
        delBtn.textContent = `🗑️ Delete Selected (${resultsSelected.size})`;
      }
    });
  });

  const deleteSelectedBtn = document.getElementById('results-delete-selected');
  if(deleteSelectedBtn){
    deleteSelectedBtn.addEventListener('click', ()=>{
      if(!resultsSelected.size) return;
      if(!confirm(`Delete ${resultsSelected.size} selected item(s)?`)) return;

      resultsSelected.forEach(key => {
        const [type, idStr] = key.split('-');
        if(type === 'interview'){
          const idx = parseInt(idStr);
          if(AppState.interview.history) AppState.interview.history.splice(idx, 1);
        } else if(type === 'skill'){
          const idx = parseInt(idStr);
          if(AppState.quiz.history) AppState.quiz.history.splice(idx, 1);
        } else if(type === 'rec'){
          AppState.recordings = (AppState.recordings||[]).filter(x => String(x.id) !== idStr);
        } else if(type === 'photo'){
          AppState.photos = (AppState.photos||[]).filter(x => String(x.id) !== idStr);
        } else if(type === 'proj'){
          AppState.projects = (AppState.projects||[]).filter(x => String(x.id) !== idStr);
        }
      });

      resultsSelected = new Set();
      saveUserData();
      toast('🗑️ Selected items deleted.');
      openModal(renderResults());
    });
  }

  document.querySelectorAll('[data-report-menu]').forEach(btn=>btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    document.querySelectorAll('.dot-menu').forEach(m=>{ if(m.id!=='report-menu-'+btn.dataset.reportMenu) m.style.display='none'; });
    const menu=document.getElementById('report-menu-'+btn.dataset.reportMenu);
    if(menu) menu.style.display = menu.style.display==='none' ? 'block' : 'none';
  }));
  document.querySelectorAll('[data-skill-menu]').forEach(btn=>btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    document.querySelectorAll('.dot-menu').forEach(m=>{ if(m.id!=='skill-menu-'+btn.dataset.skillMenu) m.style.display='none'; });
    const menu=document.getElementById('skill-menu-'+btn.dataset.skillMenu);
    if(menu) menu.style.display = menu.style.display==='none' ? 'block' : 'none';
  }));
  document.querySelectorAll('[data-recording-menu]').forEach(btn=>btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    document.querySelectorAll('.dot-menu').forEach(m=>{ if(m.id!=='recording-menu-'+btn.dataset.recordingMenu) m.style.display='none'; });
    const menu=document.getElementById('recording-menu-'+btn.dataset.recordingMenu);
    if(menu) menu.style.display = menu.style.display==='none' ? 'block' : 'none';
  }));
  document.querySelectorAll('[data-project-menu]').forEach(btn=>btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    document.querySelectorAll('.dot-menu').forEach(m=>{ if(m.id!=='project-menu-'+btn.dataset.projectMenu) m.style.display='none'; });
    const menu=document.getElementById('project-menu-'+btn.dataset.projectMenu);
    if(menu) menu.style.display = menu.style.display==='none' ? 'block' : 'none';
  }));
  document.addEventListener('click', ()=>document.querySelectorAll('.dot-menu').forEach(m=>m.style.display='none'), {once:true});

  document.querySelectorAll('[data-view-report]').forEach(b=>b.addEventListener('click', ()=>{
    const r = AppState.interview.history[parseInt(b.dataset.viewReport)];
    if(!r) return;
    openModal(`
      <h2>🎤 ${r.type} Interview Report</h2>
      <p class="sub">${r.date} · Score: <b>${r.score}/100</b></p>
      <div class="item-card" style="white-space:pre-wrap;text-align:left;">${escapeHtml(r.feedback)}</div>
      <h3>Transcript</h3>
      <div class="chat-log" style="text-align:left;">${(r.transcript||[]).map(m=>`<div class="msg ${m.role==='user'?'user':'ai'}"><b>${m.role==='user'?'You':'AI Interviewer'}:</b> ${escapeHtml(m.text)}</div>`).join('') || '<p class="sub">No transcript recorded.</p>'}</div>
      <button class="btn btn-ghost btn-sm" id="report-back" style="margin-top:12px;">← Back to Results</button>
    `);
    document.getElementById('report-back').addEventListener('click', ()=>{ openModal(renderResults()); });
  }));

  document.querySelectorAll('[data-view-skill-report]').forEach(b=>b.addEventListener('click', ()=>{
    const s = (AppState.quiz.history||[])[parseInt(b.dataset.viewSkillReport)];
    if(!s) return;
    openModal(`
      <h2>📘 ${escapeHtml(s.path)} Quiz Report</h2>
      <p class="sub">${s.date} · Score: <b>${s.pct}%</b> (${s.correctCount}/${s.totalCount} correct)</p>
      <h3>Performance Breakdown</h3>
      ${(s.breakdown||[]).map(item=>`
        <div class="item-card" style="border-left:4px solid ${item.isCorrect?'#1FBFA0':'#FF6F5E'};text-align:left;">
          <b>${escapeHtml(item.question)}</b>
          <div class="sub">${item.isCorrect?'✅ Correct':'❌ Missed'} — Correct Answer: ${item.correctLetter}) ${escapeHtml(item.correctText)}</div>
          <div class="sub" style="margin-top:4px;">${escapeHtml(item.explanation||'')}</div>
        </div>
      `).join('') || '<p class="sub">No question detail stored.</p>'}
      <button class="btn btn-ghost btn-sm" id="skill-report-back" style="margin-top:12px;">← Back to Results</button>
    `);
    document.getElementById('skill-report-back').addEventListener('click', ()=>{ openModal(renderResults()); });
  }));

  document.querySelectorAll('[data-download-skill-report]').forEach(b=>b.addEventListener('click', ()=>{
    const s = (AppState.quiz.history||[])[parseInt(b.dataset.downloadSkillReport)];
    if(!s) return;
    const reviewText = (s.breakdown||[]).map((b,i)=>`Q${i+1}: ${b.question}\nResult: ${b.isCorrect?'Correct':'Missed'}\nCorrect Answer: ${b.correctLetter}) ${b.correctText}\nExplanation: ${b.explanation}\n`).join('\n');
    const fullText = `=== Skills Quiz Report ===\nTopic: ${s.path}\nScore: ${s.pct}%\nCorrect: ${s.correctCount}/${s.totalCount}\nDate: ${s.date}\n\n=== Question Review ===\n${reviewText}`;
    const blob = new Blob([fullText], {type:'text/plain'});
    const url = URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=`Skills_Report_${s.path.replace(/[^a-z0-9]+/gi,'_')}_${s.pct}pct.txt`; a.click();
    URL.revokeObjectURL(url);
    pushNotification(`📄 Downloaded report: ${s.path} Quiz Report`);
  }));

  document.querySelectorAll('[data-delete-skill-report]').forEach(b=>b.addEventListener('click', ()=>{
    const idx=parseInt(b.dataset.deleteSkillReport);
    if(!confirm(`Delete this skills quiz report? This can't be undone.`)) return;
    (AppState.quiz.history||[]).splice(idx,1);
    saveUserData();
    toast('🗑️ Skills report deleted.');
    openModal(renderResults());
  }));

  document.querySelectorAll('[data-download-report]').forEach(b=>b.addEventListener('click', ()=>{
    const r = AppState.interview.history[parseInt(b.dataset.downloadReport)];
    if(!r) return;
    const transcriptText = (r.transcript||[]).map(m=>`${m.role==='user'?'You':'AI Interviewer'}: ${m.text}`).join('\n');
    const fullText = `=== Interview Report ===\nType: ${r.type}\nScore: ${r.score}/100\nDate: ${r.date}\n\n=== Feedback ===\n${r.feedback}\n\n=== Transcript ===\n${transcriptText}`;
    const blob = new Blob([fullText], {type:'text/plain'});
    const url = URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=`Interview_Report_${r.type}_${r.score}.txt`; a.click();
    URL.revokeObjectURL(url);
    pushNotification(`📄 Downloaded report: ${r.type} Interview Report`);
  }));

  document.querySelectorAll('[data-delete-report]').forEach(b=>b.addEventListener('click', ()=>{
    const idx=parseInt(b.dataset.deleteReport);
    const r = AppState.interview.history[idx];
    if(!r) return;
    if(!confirm(`Delete this ${r.type} interview report? This can't be undone.`)) return;
    AppState.interview.history.splice(idx,1);
    AppState.interview.scores.splice(idx,1);
    saveUserData();
    toast('🗑️ Interview report deleted.');
    openModal(renderResults());
  }));

  document.querySelectorAll('[data-preview-project]').forEach(b=>b.addEventListener('click', ()=>{
    const p = AppState.projects.find(x=>x.id==b.dataset.previewProject);
    if(!p) return;
    openModal(`
      <h2>💻 ${escapeHtml(p.name)}</h2>
      <p class="sub">${p.lang}</p>
      <code class="codebox" style="display:block;white-space:pre-wrap;text-align:left;">${escapeHtml(p.code)}</code>
      <button class="btn btn-ghost btn-sm" id="project-back" style="margin-top:12px;">← Back to Results</button>
    `);
    document.getElementById('project-back').addEventListener('click', ()=>{ openModal(renderResults()); });
  }));

  document.querySelectorAll('[data-download-project]').forEach(b=>b.addEventListener('click', async ()=>{
    const p = AppState.projects.find(x=>x.id==b.dataset.downloadProject);
    if(!p) return;
    const safeName = p.name.replace(/[^a-z0-9]+/gi,'_');
    const extMap = {javascript:'js', python:'py', cpp:'cpp', c:'c', java:'java', html:'html'};
    const ext = extMap[p.lang] || 'txt';
    const fileName = `${safeName}.${ext}`;

    if(window.JSZip){
      const zip = new JSZip();
      zip.file(fileName, p.code);
      zip.file("README.txt", `Project: ${p.name}\nLanguage: ${p.lang}\nSaved via S2 Talk Platform.`);
      const content = await zip.generateAsync({type:"blob"});
      const url = URL.createObjectURL(content);
      const a = document.createElement('a'); a.href = url; a.download = `${safeName}.zip`; a.click();
      URL.revokeObjectURL(url);
      pushNotification(`💾 Downloaded project zip: ${safeName}.zip`);
    } else {
      const blob = new Blob([p.code], {type:'text/plain'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${safeName}.${ext}`; a.click();
      URL.revokeObjectURL(url);
      pushNotification(`💾 Downloaded project: ${p.name}`);
    }
  }));

  document.querySelectorAll('[data-delete-project-result]').forEach(b=>b.addEventListener('click', ()=>{
    const p = AppState.projects.find(x=>x.id==b.dataset.deleteProjectResult);
    if(!p) return;
    if(!confirm(`Delete "${p.name}"? This can't be undone.`)) return;
    AppState.projects = AppState.projects.filter(x=>x.id!==p.id);
    saveUserData();
    toast('🗑️ Project deleted.');
    openModal(renderResults());
  }));

  document.querySelectorAll('[data-photo-menu]').forEach(btn=>btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    document.querySelectorAll('.dot-menu').forEach(m=>{ if(m.id!=='photo-menu-'+btn.dataset.photoMenu) m.style.display='none'; });
    const menu=document.getElementById('photo-menu-'+btn.dataset.photoMenu);
    if(menu) menu.style.display = menu.style.display==='none' ? 'block' : 'none';
  }));

  document.querySelectorAll('[data-view-photo]').forEach(b=>b.addEventListener('click', ()=>{
    const p = (AppState.photos||[]).find(x=>x.id==b.dataset.viewPhoto);
    if(!p) return;
    openModal(`
      <h2>📷 Interview Photo</h2>
      <p class="sub">${p.date} ${p.time || ''}</p>
      <img src="${p.dataUrl}" style="max-width:100%;border-radius:12px;margin-top:8px;">
      <button class="btn btn-ghost btn-sm" id="photo-view-back" style="margin-top:12px;">← Back to Results</button>
    `);
    document.getElementById('photo-view-back').addEventListener('click', ()=>{ openModal(renderResults()); });
  }));

  document.querySelectorAll('[data-download-photo]').forEach(b=>b.addEventListener('click', ()=>{
    const p = (AppState.photos||[]).find(x=>x.id==b.dataset.downloadPhoto);
    if(!p) return;
    const a = document.createElement('a'); a.href = p.dataUrl; a.download = `Interview_Photo_${p.id}.png`; a.click();
    toast('⬇ Downloaded photo.');
  }));

  document.querySelectorAll('[data-share-photo]').forEach(b=>b.addEventListener('click', ()=>{
    const p = (AppState.photos||[]).find(x=>x.id==b.dataset.sharePhoto);
    if(!p) return;
    sendSharePayload({kind:'photo', title:'Interview Photo', subtitle:p.date+' '+p.time, dataUrl:p.dataUrl});
  }));

  document.querySelectorAll('[data-delete-photo]').forEach(b=>b.addEventListener('click', ()=>{
    const p = (AppState.photos||[]).find(x=>x.id==b.dataset.deletePhoto);
    if(!p) return;
    if(confirm('Delete this photo?')){
      AppState.photos = (AppState.photos||[]).filter(x=>x.id!==p.id);
      saveUserData();
      toast('🗑️ Photo deleted.');
      openModal(renderResults());
    }
  }));

  document.querySelectorAll('[data-view-recording]').forEach(b=>b.addEventListener('click', ()=>{
    const r = (AppState.recordings||[]).find(x=>x.id==b.dataset.viewRecording);
    if(!r) return;
    openModal(`
      <h2>🎥 ${escapeHtml(r.name)}</h2>
      <video class="cam" controls src="${r.url}" style="width:100%;border-radius:14px;margin-top:8px;background:#000;"></video>
      <button class="btn btn-ghost btn-sm" id="rec-back" style="margin-top:12px;">← Back to Results</button>
    `);
    document.getElementById('rec-back').addEventListener('click', ()=>{ openModal(renderResults()); });
  }));

  document.querySelectorAll('[data-delete-recording]').forEach(b=>b.addEventListener('click', ()=>{
    const r = (AppState.recordings||[]).find(x=>x.id==b.dataset.deleteRecording);
    if(!r) return;
    if(!confirm(`Delete "${r.name}"? This can't be undone.`)) return;
    try{ URL.revokeObjectURL(r.url); }catch(e){}
    AppState.recordings = AppState.recordings.filter(x=>x.id!==r.id);
    saveUserData();
    toast('🗑️ Recording deleted.');
    openModal(renderResults());
  }));

  if(resultsTab === 'leaderboard') {
    try{
      const res = await fetch('/api/leaderboard');
      if(res.ok){
        const data = await res.json();
        AppState.leaderboard = data.leaderboard || [];
        if(currentModalView==='results' && overlay.style.display==='flex' && resultsTab==='leaderboard'){
          openModal(renderResults());
        }
      }
    }catch(e){ /* backend not reachable */ }
  }
}
async function submitScore(category, points, meta){
  try{ await fetch('/api/score', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({category, points, meta:meta||''})}); }
  catch(e){ /* offline — score just won't reach the leaderboard this time */ }
}

/* ============================================================
   BUILDING 5 — S2 AI AGENT HOUSE
   ============================================================ */
let aiHistory=[];
let aiSessions=[];          // {id, title, createdAt, updatedAt, messages:[{role,text}]}
let aiCurrentSessionId=null;
let aiHistoryPanelOpen=false;
let aiSearchQuery='';

function aiMakeTitle(text){
  const t = (text||'').trim().replace(/\s+/g,' ');
  return t.length > 42 ? t.slice(0,42)+'…' : (t || 'New Chat');
}
function aiFormatWhen(ts){
  const d = new Date(ts);
  if(isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric'}) + ' · ' + d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
}
// Auto-saves the in-progress conversation into aiSessions (create on first
// message, update thereafter) so nothing is lost on refresh — mirrors the
// permanent-local-storage requirement and ChatGPT-style history behavior.
function aiPersistCurrentSession(){
  if(!aiHistory.length) return;
  const now = Date.now();
  if(aiCurrentSessionId){
    const s = aiSessions.find(x=>x.id===aiCurrentSessionId);
    if(s){ s.messages = aiHistory; s.updatedAt = now; }
    else { aiCurrentSessionId = null; aiPersistCurrentSession(); return; }
  } else {
    const firstUser = aiHistory.find(m=>m.role==='user');
    const id = 'aichat_' + now + '_' + Math.random().toString(36).slice(2,7);
    aiSessions.unshift({ id, title: aiMakeTitle(firstUser ? firstUser.text : 'New Chat'), createdAt: now, updatedAt: now, messages: aiHistory });
    aiCurrentSessionId = id;
  }
  saveUserData();
}
function renderAIHistoryPanel(){
  const q = aiSearchQuery.trim().toLowerCase();
  const sessions = [...aiSessions]
    .filter(s => !q || s.title.toLowerCase().includes(q))
    .sort((a,b)=>b.updatedAt-a.updatedAt);
  return `
    <div id="ai-history-panel" style="position:absolute;top:0;left:0;bottom:0;width:min(300px,82%);background:var(--panel);border-right:1px solid var(--panel-border);border-radius:24px 0 0 24px;box-shadow:12px 0 30px rgba(20,18,60,.18);z-index:5;display:flex;flex-direction:column;padding:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <h3 style="margin:0;">🕘 History</h3>
        <button class="btn btn-ghost btn-sm" id="ai-history-close" title="Close">✕</button>
      </div>
      <input class="inp" id="ai-history-search" placeholder="Search chats..." value="${escapeHtml(aiSearchQuery)}" style="margin-bottom:10px;">
      <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
        ${sessions.length ? sessions.map(s=>`
          <div class="item-card ai-hist-item" data-open-ai-chat="${s.id}" style="cursor:pointer;padding:10px;${s.id===aiCurrentSessionId?'border-color:var(--indigo);':''}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
              <b style="font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.title)}</b>
              <button class="btn btn-ghost btn-sm" data-rename-ai-chat="${s.id}" title="Rename" style="padding:2px 6px;">✏️</button>
              <button class="btn btn-ghost btn-sm" data-delete-ai-chat="${s.id}" title="Delete" style="padding:2px 6px;color:#FF6F5E;">✕</button>
            </div>
            <div class="sub" style="font-size:11px;margin-top:2px;">${aiFormatWhen(s.updatedAt)}</div>
          </div>
        `).join('') : `<p class="sub">${q ? 'No chats match your search.' : 'No previous chats yet — start typing below!'}</p>`}
      </div>
    </div>
  `;
}
function renderAI(){
  const quick=["Give me career advice.","Suggest improvements to my resume.","What should I learn next?","Recommend a friend with similar skills."];
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <button class="btn btn-ghost btn-sm" id="ai-history-toggle" title="Chat history">🕘 History</button>
      <button class="btn btn-ghost btn-sm" id="ai-newchat" title="Start a new chat">🆕 New Chat</button>
    </div>
    <h2>🤖 S2 AI Agent</h2>
    <p class="sub">Your personal assistant — remembers your profile and progress this session.</p>
    <div class="chat-log" id="ai-log">${aiHistory.length? aiHistory.map(m=>`<div class="msg ${m.role==='user'?'user':'ai'}"><b>${m.role==='user'?'You':'S2 Agent'}:</b> ${escapeHtml(m.text)}</div>`).join('') : `<div class="msg ai"><b>S2 Agent:</b> Hi ${AppState.current.name.split(' ')[0]}! Ask me about careers, resumes, coding help, or who to connect with.</div>`}</div>
    <div>${quick.map(q=>`<span class="quick-q" data-q="${q}">${q}</span>`).join('')}</div>
    <div class="chat-row" style="margin-top:10px;">
      <input class="inp" id="ai-input" placeholder="Ask the S2 Agent anything...">
      <button class="btn btn-ghost btn-sm" id="ai-mic" title="Speak your question">🎙️</button>
      <button class="btn btn-primary btn-sm" id="ai-send">Send</button>
    </div>
    ${aiHistoryPanelOpen ? renderAIHistoryPanel() : ''}
  `;
}
async function sendAI(q){
  aiHistory.push({role:'user', text:q});
  aiPersistCurrentSession();
  openModal(renderAI());
  const sys = `You are S2 Agent, a friendly personal AI assistant inside the S2 Talk platform. User profile — ${profileSummary()}. Progress: interview scores ${JSON.stringify(AppState.interview.scores)}, skills quiz results ${JSON.stringify(AppState.quiz.completed)}, ${(AppState.acceptedFriends||[]).length} friends added, ${AppState.projects.length} saved projects. Give warm, specific, concise (3-6 sentence) advice.`;
  const msgs = aiHistory.map(m=>({role:m.role==='user'?'user':'assistant', content:m.text}));
  const out = await callClaude(sys, msgs, 400);
  aiHistory.push({role:'assistant', text:out});
  aiPersistCurrentSession();
  openModal(renderAI());
}

/* ============================================================
   BUILDING 6 — TALK HOUSE
   ============================================================ */
let activeFriendUid=null;
let talkPollTimer=null;
function loadPinnedFriends(){
  try{
    const uid = AppState.current ? AppState.current.uid : null;
    const key = uid ? 's2talk_pinned_friends_' + uid : 's2talk_pinned_friends';
    return new Set(JSON.parse(localStorage.getItem(key)||'[]'));
  }catch(e){ return new Set(); }
}
function savePinnedFriends(set){
  try{
    const uid = AppState.current ? AppState.current.uid : null;
    const key = uid ? 's2talk_pinned_friends_' + uid : 's2talk_pinned_friends';
    localStorage.setItem(key, JSON.stringify([...set]));
  }catch(e){}
}
let pinnedFriends = new Set(); // populated per-account by loadUserData() once the session is known
function sortedFriends(){
  const friends = AppState.acceptedFriends || [];
  return [...friends].sort((a,b)=>{
    const ap = pinnedFriends.has(a.uid) ? 0 : 1;
    const bp = pinnedFriends.has(b.uid) ? 0 : 1;
    if(ap!==bp) return ap-bp;
    return a.name.localeCompare(b.name);
  });
}
let talkSelectMode = false;
let talkSelectedMsgs = new Set();

function renderChatMessage(m, friendName, index){
  const who = m.from==='me' ? 'You' : escapeHtml(friendName);
  const chk = talkSelectMode ? `<input type="checkbox" class="contact-select-box talk-msg-chk" data-msg-id="${m.id}" ${talkSelectedMsgs.has(m.id)?'checked':''} style="margin-right:8px;vertical-align:middle;margin-top:2px;">` : '';
  
  let contentHtml = '';
  if(m.attachmentType==='voice' && m.attachmentUrl){
    contentHtml = `<b>${who}:</b><br><audio controls src="${m.attachmentUrl}" style="max-width:100%;margin-top:4px;"></audio>`;
  } else if(m.attachmentType==='share'){
    let payload=null;
    try{ payload = JSON.parse(m.text); }catch(e){}
    if(payload){
      const icons={project:'💾', interview:'🎤', skills:'📘', recording:'🎥', photo:'📷'};
      contentHtml = `<b>${who}:</b>
        <div class="share-card click" data-open-share="${index}">
          <span class="share-icon">${icons[payload.kind]||'📎'}</span>
          <div><b>${escapeHtml(payload.title)}</b><div class="sub">${escapeHtml(payload.subtitle||'')}</div><div class="sub" style="color:var(--indigo);">Tap to open ↗</div></div>
        </div>`;
    }
  } else {
    contentHtml = `<b>${who}:</b> ${escapeHtml(m.text)}`;
  }
  
  return `<div style="display:flex;align-items:center;margin-bottom:8px;width:100%;">
    ${chk}
    <div class="msg ${m.from==='me'?'user':'friend'}">${contentHtml}</div>
  </div>`;
}

let myMediaSelectMode = false;
let myMediaSelected = new Set();
let receivedMediaSelectMode = false;
let receivedMediaSelected = new Set();

async function syncReceivedMediaAllFriends(){
  const friends = AppState.acceptedFriends || [];
  for(const f of friends){
    try {
      const res = await fetch('/api/messages/' + f.uid);
      if(res.ok){
        const data = await res.json();
        registerReceivedMediaFromMessages(data.messages || [], f);
      }
    } catch(e){}
  }
}

function registerReceivedMediaFromMessages(messages, friend){
  if(!AppState.receivedMedia) AppState.receivedMedia = [];
  const existingIds = new Set(AppState.receivedMedia.map(x=>String(x.id)));

  (messages||[]).forEach(m => {
    if(m.from !== 'me'){
      let payload = null;
      try { payload = JSON.parse(m.text); } catch(e){}
      
      const itemDate = m.created_at ? new Date(m.created_at).toLocaleDateString() : 'Today';
      const senderName = (friend ? friend.name : null) || m.from || 'Friend';

      if(payload && payload.kind){
        const rxId = 'rx_' + (m.id || (m.created_at + '_' + payload.kind));
        if(!existingIds.has(rxId)){
          const iconMap = { project: '💾', recording: '🎥', photo: '📷', file: '📄', interview: '🎤', skills: '📘', voice: '🎤' };
          AppState.receivedMedia.push({
            id: rxId,
            name: payload.title || payload.name || `${payload.kind.toUpperCase()} Item`,
            senderName: senderName,
            date: itemDate,
            kind: payload.kind,
            icon: iconMap[payload.kind] || '📩',
            payload: payload
          });
          existingIds.add(rxId);
        }
      } else if(m.attachment_url || (m.text && (m.text.includes('/static/uploads/') || m.text.endsWith('.webm') || m.text.endsWith('.png') || m.text.endsWith('.pdf')))){
        const rxId = 'rx_att_' + (m.id || m.created_at);
        if(!existingIds.has(rxId)){
          const isVoice = m.attachment_type === 'voice' || (m.attachment_url && m.attachment_url.includes('/voice/'));
          AppState.receivedMedia.push({
            id: rxId,
            name: isVoice ? 'Voice Recording' : 'Attachment File',
            senderName: senderName,
            date: itemDate,
            kind: isVoice ? 'recording' : 'file',
            icon: isVoice ? '🎤' : '📎',
            url: m.attachment_url || m.text
          });
          existingIds.add(rxId);
        }
      }
    }
  });
  saveUserData();
}

function openMediaPanel(){
  syncReceivedMediaAllFriends().then(() => {
    if(currentModalView==='media' && overlay.style.display==='flex'){
      renderMediaPanelUI();
    }
  });
  renderMediaPanelUI();
}

function renderMediaPanelUI(){
  currentModalView = 'media';
  const photos = AppState.photos || [];
  const recs = AppState.recordings || [];
  const projs = AppState.projects || [];
  const files = AppState.files || [];
  const receivedMedia = AppState.receivedMedia || [];

  const openShareModal = (itemsToShare, titleLabel="Share Media") => {
    const friends = sortedFriends();
    if(!friends.length){
      toast('👥 No friends found in your Contacts House to share with.');
      return;
    }
    const selectedShareFriends = new Set();
    
    openModal(`
      <h2>📤 ${escapeHtml(titleLabel)}</h2>
      <p class="sub">Select friends to forward ${itemsToShare.length} item(s) to:</p>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <button class="btn btn-ghost btn-sm" id="share-select-all">☑ Select All</button>
        <span id="share-count-badge" class="sub">0 friends selected</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:240px;overflow-y:auto;margin:8px 0;">
        ${friends.map(f => `
          <div class="item-card" style="display:flex;align-items:center;justify-content:space-between;padding:10px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <input type="checkbox" data-select-friend-share="${f.uid}" style="width:18px;height:18px;cursor:pointer;">
              <div style="width:36px;height:36px;border-radius:50%;background:var(--bg2);display:flex;align-items:center;justify-content:center;font-size:18px;">${f.pic ? `<img loading="lazy" src="${f.pic}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : (f.avatarEmoji||'🙂')}</div>
              <div><b>${escapeHtml(f.name)}</b><div class="sub">ID: ${f.uid}</div></div>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="btn-row" style="margin-top:12px;gap:8px;">
        <button class="btn btn-primary btn-sm" id="share-submit-multi" disabled>📤 Share with Selected Friends</button>
        <button class="btn btn-ghost btn-sm" id="share-modal-cancel">Cancel</button>
      </div>
    `);

    const updateShareBadge = () => {
      const badge = document.getElementById('share-count-badge');
      const submitBtn = document.getElementById('share-submit-multi');
      if(badge) badge.textContent = `${selectedShareFriends.size} friend(s) selected`;
      if(submitBtn) submitBtn.disabled = selectedShareFriends.size === 0;
    };

    document.getElementById('share-select-all')?.addEventListener('click', () => {
      const allCbs = document.querySelectorAll('[data-select-friend-share]');
      const allSelected = selectedShareFriends.size === friends.length;
      allCbs.forEach(cb => {
        cb.checked = !allSelected;
        const uid = cb.dataset.selectFriendShare;
        if(!allSelected) selectedShareFriends.add(uid); else selectedShareFriends.delete(uid);
      });
      updateShareBadge();
    });

    document.querySelectorAll('[data-select-friend-share]').forEach(cb => {
      cb.addEventListener('change', () => {
        const uid = cb.dataset.selectFriendShare;
        if(cb.checked) selectedShareFriends.add(uid); else selectedShareFriends.delete(uid);
        updateShareBadge();
      });
    });

    document.getElementById('share-modal-cancel').addEventListener('click', openMediaPanel);

    document.getElementById('share-submit-multi')?.addEventListener('click', async () => {
      if(!selectedShareFriends.size) return;
      const submitBtn = document.getElementById('share-submit-multi');
      submitBtn.disabled = true; submitBtn.textContent = 'Sharing...';

      // Photos are base64 data URLs — too large for a chat message (capped
      // at 4000 chars server-side). Upload each one once up front so every
      // recipient gets the same short URL instead of a truncated payload.
      for(const item of itemsToShare){
        if((item.kind==='photo' || item.type==='photo') && item.dataUrl && !item.url){
          item.url = await uploadPhotoDataUrl(item.dataUrl);
        }
      }

      const friendUids = Array.from(selectedShareFriends);
      for(const friendUid of friendUids){
        const friendObj = (AppState.acceptedFriends||[]).find(f => f.uid === friendUid);
        for(const item of itemsToShare){
          if((item.kind==='photo' || item.type==='photo') && !item.url){ continue; /* upload failed — skip rather than send a broken payload */ }
          try {
            let payloadText = '';
            if(item.kind || item.type){
              payloadText = JSON.stringify({
                kind: item.kind || item.type,
                title: item.name || 'Shared Item',
                subtitle: item.subtitle || (item.lang ? item.lang.toUpperCase() : 'Shared Media'),
                lang: item.lang,
                code: item.code,
                url: item.url,
                score: item.score,
                feedback: item.feedback
              });
            } else {
              payloadText = item.name || 'Shared Media Item';
            }
            const res = await fetch('/api/messages/' + friendUid, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: payloadText, attachmentType: 'share' })
            });
            if(res.ok){
              const data = await res.json();
              if(data.messages){
                if(!AppState.talkLogMap) AppState.talkLogMap = {};
                AppState.talkLogMap[friendUid] = data.messages;
                if(activeFriendUid === friendUid){
                  AppState.talkLog = data.messages;
                  const logEl = document.getElementById('talk-log');
                  if(logEl){
                    logEl.innerHTML = data.messages.length ? data.messages.map((m, index) => renderChatMessage(m, friendObj ? friendObj.name : '', index)).join('') : `<p class="sub">No messages yet — say hi!</p>`;
                    logEl.scrollTop = logEl.scrollHeight;
                  }
                }
                registerReceivedMediaFromMessages(data.messages, friendObj);
              }
            }
          } catch(e){}
        }
      }
      Audio_.messageSent();
      toast(`✅ Shared ${itemsToShare.length} item(s) with ${selectedShareFriends.size} friend(s)!`);
      openMediaPanel();
    });

  };

  openModal(`
    <h2>📁 Media Panel</h2>
    <p class="sub">Manage and share your photos, recordings, files, projects, and received media.</p>

    <!-- SECTION 1 : MY MEDIA -->
    <div style="border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:16px;background:var(--bg1);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <h3 style="margin:0;color:var(--brand,#5B4FE8);">Section 1 : My Media</h3>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="btn btn-sm ${myMediaSelectMode?'btn-primary':'btn-outline'}" id="my-media-select-toggle">
            ${myMediaSelectMode ? '✓ Cancel' : '[Select]'}
          </button>
          ${myMediaSelectMode ? `
            <button class="btn btn-sm btn-primary" id="my-media-share-btn" ${myMediaSelected.size?'':'disabled'}>📤 Share</button>
            <button class="btn btn-sm" style="background:#FF6F5E;color:#fff;" id="my-media-delete-btn" ${myMediaSelected.size?'':'disabled'}>🗑️ Delete</button>
          ` : ''}
        </div>
      </div>

      <h4 style="margin:8px 0 4px;font-size:14px;">📷 My Photos (${photos.length})</h4>
      ${photos.length ? photos.map(p => `
        <div class="item-card"><div class="row" style="align-items:center;">
          ${myMediaSelectMode ? `<input type="checkbox" data-select-my-media="photo-${p.id}" ${myMediaSelected.has('photo-'+p.id)?'checked':''} style="width:18px;height:18px;margin-right:8px;cursor:pointer;">` : ''}
          <img loading="lazy" src="${p.dataUrl}" style="width:36px;height:36px;border-radius:6px;object-fit:cover;margin-right:8px;">
          <div style="flex:1;"><b>Interview Photo</b><div class="sub">${p.date} ${p.time||''}</div></div>
          ${!myMediaSelectMode ? `
            <div class="dot-menu-wrap">
              <button class="btn btn-ghost btn-sm dot-menu-btn" data-media-menu="photo-${p.id}">⋮</button>
              <div class="dot-menu" id="media-menu-photo-${p.id}" style="display:none;">
                <button data-media-open-photo="${p.id}">Open</button>
                <button data-media-download-photo="${p.id}">Download</button>
                <button data-media-del-photo="${p.id}" style="color:#FF6F5E;">Delete For Me</button>
              </div>
            </div>
          ` : ''}
        </div></div>`).join('') : '<p class="sub">No photos saved.</p>'}

      <h4 style="margin:12px 0 4px;font-size:14px;">🎥 My Videos &amp; Recordings (${recs.length})</h4>
      ${recs.length ? recs.map(r => `
        <div class="item-card"><div class="row" style="align-items:center;">
          ${myMediaSelectMode ? `<input type="checkbox" data-select-my-media="rec-${r.id}" ${myMediaSelected.has('rec-'+r.id)?'checked':''} style="width:18px;height:18px;margin-right:8px;cursor:pointer;">` : ''}
          <span class="icon">🎥</span><div style="flex:1;"><b>${escapeHtml(r.name)}</b><div class="sub">${(r.size/1024).toFixed(0)} KB</div></div>
          ${!myMediaSelectMode ? `
            <div class="dot-menu-wrap">
              <button class="btn btn-ghost btn-sm dot-menu-btn" data-media-menu="rec-${r.id}">⋮</button>
              <div class="dot-menu" id="media-menu-rec-${r.id}" style="display:none;">
                <button data-media-open-rec="${r.id}">Open</button>
                <a href="${r.url}" download="${r.name.replace(/[^a-z0-9]+/gi,'_')}.webm" style="color:inherit;text-decoration:none;padding:9px 10px;text-align:left;display:block;">Download</a>
                <button data-media-del-rec="${r.id}" style="color:#FF6F5E;">Delete For Me</button>
              </div>
            </div>
          ` : ''}
        </div></div>`).join('') : '<p class="sub">No video recordings saved.</p>'}

      <h4 style="margin:12px 0 4px;font-size:14px;">📁 My Files (${files.length})</h4>
      ${files.length ? files.map(f => `
        <div class="item-card"><div class="row" style="align-items:center;">
          ${myMediaSelectMode ? `<input type="checkbox" data-select-my-media="file-${f.id}" ${myMediaSelected.has('file-'+f.id)?'checked':''} style="width:18px;height:18px;margin-right:8px;cursor:pointer;">` : ''}
          <span class="icon">📄</span><div style="flex:1;"><b>${escapeHtml(f.name)}</b><div class="sub">${f.size||'Document'}</div></div>
          ${!myMediaSelectMode ? `
            <button class="btn btn-ghost btn-sm" data-media-del-file="${f.id}" style="color:#FF6F5E;">🗑️</button>
          ` : ''}
        </div></div>`).join('') : '<p class="sub">No files uploaded.</p>'}

      <h4 style="margin:12px 0 4px;font-size:14px;">💾 My Saved Projects (${projs.length})</h4>
      ${projs.length ? projs.map(p => `
        <div class="item-card"><div class="row" style="align-items:center;">
          ${myMediaSelectMode ? `<input type="checkbox" data-select-my-media="proj-${p.id}" ${myMediaSelected.has('proj-'+p.id)?'checked':''} style="width:18px;height:18px;margin-right:8px;cursor:pointer;">` : ''}
          <span class="icon">💾</span><div style="flex:1;"><b>${escapeHtml(p.name)}</b><div class="sub">${(p.lang||'javascript').toUpperCase()}</div></div>
          ${!myMediaSelectMode ? `
            <div class="dot-menu-wrap">
              <button class="btn btn-ghost btn-sm dot-menu-btn" data-media-menu="proj-${p.id}">⋮</button>
              <div class="dot-menu" id="media-menu-proj-${p.id}" style="display:none;">
                <button data-media-open-proj="${p.id}">View / Edit</button>
                <button data-media-import-proj="${p.id}">Import To Project Lab</button>
                <button data-media-del-proj="${p.id}" style="color:#FF6F5E;">Delete For Me</button>
              </div>
            </div>
          ` : ''}
        </div></div>`).join('') : '<p class="sub">No saved projects.</p>'}
    </div>

    <div style="border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:16px;background:var(--bg1);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <h3 style="margin:0;color:var(--brand,#5B4FE8);">Section 2 : Received Media</h3>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="btn btn-sm ${receivedMediaSelectMode?'btn-primary':'btn-outline'}" id="received-media-select-toggle">
            ${receivedMediaSelectMode ? '✓ Cancel' : '[Select]'}
          </button>
          ${receivedMediaSelectMode ? `
            <button class="btn btn-sm btn-primary" id="received-media-share-btn" ${receivedMediaSelected.size?'':'disabled'}>🔄 Share Again</button>
            <button class="btn btn-sm" style="background:#FF6F5E;color:#fff;" id="received-media-delete-btn" ${receivedMediaSelected.size?'':'disabled'}>🗑️ Delete</button>
          ` : ''}
        </div>
      </div>

      ${receivedMedia.length ? receivedMedia.map(m => `
        <div class="item-card"><div class="row" style="align-items:center;">
          ${receivedMediaSelectMode ? `<input type="checkbox" data-select-received-media="${m.id}" ${receivedMediaSelected.has(m.id)?'checked':''} style="width:18px;height:18px;margin-right:8px;cursor:pointer;">` : ''}
          ${m.kind==='photo' && m.payload && m.payload.url ? `<img loading="lazy" src="${m.payload.url}" style="width:36px;height:36px;border-radius:6px;object-fit:cover;margin-right:8px;">` : `<span class="icon">${m.icon||'📩'}</span>`}
          <div style="flex:1;${!receivedMediaSelectMode?'cursor:pointer;':''}" ${!receivedMediaSelectMode ? `data-open-received-media="${m.id}"` : ''}>
            <b>${escapeHtml(m.name||'Received Media')}</b>
            <div class="sub">From ${escapeHtml(m.senderName||'Friend')} · ${m.date||''}</div>
          </div>
          ${!receivedMediaSelectMode ? `<button class="btn btn-ghost btn-sm" data-del-received-item="${m.id}" style="color:#FF6F5E;">🗑️ Delete</button>` : ''}
        </div></div>
      `).join('') : '<p class="sub">No received media items yet.</p>'}
    </div>

    <button class="btn btn-ghost btn-sm" id="media-back" style="margin-top:8px;">← Back to Talk House</button>
  `);

  document.getElementById('media-back').addEventListener('click', ()=>{ openModal(renderTalk()); });

  const myToggle = document.getElementById('my-media-select-toggle');
  if(myToggle){
    myToggle.addEventListener('click', () => {
      myMediaSelectMode = !myMediaSelectMode;
      myMediaSelected = new Set();
      openMediaPanel();
    });
  }

  document.querySelectorAll('[data-select-my-media]').forEach(cb => {
    cb.addEventListener('change', () => {
      const key = cb.dataset.selectMyMedia;
      if(cb.checked) myMediaSelected.add(key); else myMediaSelected.delete(key);
      const shareBtn = document.getElementById('my-media-share-btn');
      const delBtn = document.getElementById('my-media-delete-btn');
      if(shareBtn) shareBtn.disabled = myMediaSelected.size === 0;
      if(delBtn) delBtn.disabled = myMediaSelected.size === 0;
    });
  });

  const myShareBtn = document.getElementById('my-media-share-btn');
  if(myShareBtn){
    myShareBtn.addEventListener('click', () => {
      if(!myMediaSelected.size) return;
      const itemsToShare = [];
      myMediaSelected.forEach(key => {
        const dashIdx = key.indexOf('-');
        const type = key.substring(0, dashIdx);
        const id = key.substring(dashIdx + 1);
        if(type==='photo'){
          const item = (AppState.photos||[]).find(x => String(x.id) === String(id));
          if(item) itemsToShare.push({type:'photo', name:'Photo', dataUrl:item.dataUrl});
        } else if(type==='rec'){
          const item = (AppState.recordings||[]).find(x => String(x.id) === String(id));
          if(item) itemsToShare.push({type:'recording', name:item.name, url:item.url});
        } else if(type==='proj'){
          const item = (AppState.projects||[]).find(x => String(x.id) === String(id));
          if(item) itemsToShare.push({type:'project', name:item.name, lang:item.lang, code:item.code});
        } else if(type==='file'){
          const item = (AppState.files||[]).find(x => String(x.id) === String(id));
          if(item) itemsToShare.push({type:'file', name:item.name});
        }
      });
      openShareModal(itemsToShare, "Share My Media");
    });
  }

  const myDeleteBtn = document.getElementById('my-media-delete-btn');
  if(myDeleteBtn){
    myDeleteBtn.addEventListener('click', () => {
      if(!myMediaSelected.size) return;
      if(!confirm(`Delete ${myMediaSelected.size} selected item(s) from My Media?`)) return;
      myMediaSelected.forEach(key => {
        const dashIdx = key.indexOf('-');
        const type = key.substring(0, dashIdx);
        const id = key.substring(dashIdx + 1);
        if(type==='photo') AppState.photos = (AppState.photos||[]).filter(x => String(x.id) !== String(id));
        else if(type==='rec') AppState.recordings = (AppState.recordings||[]).filter(x => String(x.id) !== String(id));
        else if(type==='proj') AppState.projects = (AppState.projects||[]).filter(x => String(x.id) !== String(id));
        else if(type==='file') AppState.files = (AppState.files||[]).filter(x => String(x.id) !== String(id));
      });
      myMediaSelected = new Set();
      saveUserData();
      toast('🗑️ Selected items deleted from My Media.');
      openMediaPanel();
    });
  }

  // Toggle Received Media Select Mode
  const rxToggle = document.getElementById('received-media-select-toggle');
  if(rxToggle){
    rxToggle.addEventListener('click', () => {
      receivedMediaSelectMode = !receivedMediaSelectMode;
      receivedMediaSelected = new Set();
      openMediaPanel();
    });
  }

  // Handle Received Media Item Selection
  document.querySelectorAll('[data-select-received-media]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.selectReceivedMedia;
      if(cb.checked) receivedMediaSelected.add(id); else receivedMediaSelected.delete(id);
      const shareBtn = document.getElementById('received-media-share-btn');
      const delBtn = document.getElementById('received-media-delete-btn');
      if(shareBtn) shareBtn.disabled = receivedMediaSelected.size === 0;
      if(delBtn) delBtn.disabled = receivedMediaSelected.size === 0;
    });
  });

  // Received Media Share Again Action
  const rxShareBtn = document.getElementById('received-media-share-btn');
  if(rxShareBtn){
    rxShareBtn.addEventListener('click', () => {
      if(!receivedMediaSelected.size) return;
      const itemsToShare = [];
      receivedMediaSelected.forEach(id => {
        const item = (AppState.receivedMedia||[]).find(x => String(x.id) === String(id));
        if(item){
          const p = item.payload || {};
          itemsToShare.push({
            kind: item.kind,
            name: item.name,
            subtitle: p.subtitle,
            lang: p.lang,
            code: p.code,
            url: p.url || item.url,
            score: p.score,
            feedback: p.feedback
          });
        }
      });
      openShareModal(itemsToShare, "Forward Received Media");
    });
  }

  // Received Media Bulk Delete Action
  const rxDeleteBtn = document.getElementById('received-media-delete-btn');
  if(rxDeleteBtn){
    rxDeleteBtn.addEventListener('click', () => {
      if(!receivedMediaSelected.size) return;
      if(!confirm(`Delete ${receivedMediaSelected.size} selected item(s) from Received Media?`)) return;
      AppState.receivedMedia = (AppState.receivedMedia||[]).filter(x => !receivedMediaSelected.has(String(x.id)));
      receivedMediaSelected = new Set();
      saveUserData();
      toast('🗑️ Selected received items deleted.');
      openMediaPanel();
    });
  }

  // Delete single received item
  document.querySelectorAll('[data-del-received-item]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.delReceivedItem;
      AppState.receivedMedia = (AppState.receivedMedia||[]).filter(x => String(x.id) !== String(id));
      saveUserData();
      openMediaPanel();
    });
  });

  document.querySelectorAll('[data-open-received-media]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.openReceivedMedia;
      const item = (AppState.receivedMedia||[]).find(x => String(x.id) === String(id));
      if(item && item.payload) openSharedContent(item.payload);
    });
  });

  document.querySelectorAll('[data-media-menu]').forEach(btn=>btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    document.querySelectorAll('.dot-menu').forEach(m=>{ if(m.id!=='media-menu-'+btn.dataset.mediaMenu) m.style.display='none'; });
    const menu=document.getElementById('media-menu-'+btn.dataset.mediaMenu);
    if(menu) menu.style.display = menu.style.display==='none' ? 'block' : 'none';
  }));

  document.querySelectorAll('[data-media-open-photo]').forEach(b=>b.addEventListener('click', ()=>{
    const p = (AppState.photos||[]).find(x=>x.id==b.dataset.mediaOpenPhoto);
    if(p) openModal(`<h2>📷 Photo</h2><img src="${p.dataUrl}" style="max-width:100%;border-radius:12px;"><button class="btn btn-ghost btn-sm" id="mb" style="margin-top:12px;">Back</button>`);
    document.getElementById('mb')?.addEventListener('click', openMediaPanel);
  }));

  document.querySelectorAll('[data-media-download-photo]').forEach(b=>b.addEventListener('click', ()=>{
    const p = (AppState.photos||[]).find(x=>x.id==b.dataset.mediaDownloadPhoto);
    if(p){ const a = document.createElement('a'); a.href = p.dataUrl; a.download = `Photo_${p.id}.png`; a.click(); }
  }));

  document.querySelectorAll('[data-media-del-photo]').forEach(b=>b.addEventListener('click', ()=>{
    const pid = b.dataset.mediaDelPhoto;
    AppState.photos = (AppState.photos||[]).filter(x=>x.id!=pid); saveUserData(); openMediaPanel();
  }));

  document.querySelectorAll('[data-media-open-rec]').forEach(b=>b.addEventListener('click', ()=>{
    const r = (AppState.recordings||[]).find(x=>x.id==b.dataset.mediaOpenRec);
    if(r) openModal(`<h2>🎥 ${escapeHtml(r.name)}</h2><video class="cam" controls src="${r.url}" style="width:100%;border-radius:12px;margin-top:8px;"></video><button class="btn btn-ghost btn-sm" id="mb" style="margin-top:12px;">Back</button>`);
    document.getElementById('mb')?.addEventListener('click', openMediaPanel);
  }));

  document.querySelectorAll('[data-media-del-rec]').forEach(b=>b.addEventListener('click', ()=>{
    const rid = b.dataset.mediaDelRec;
    AppState.recordings = (AppState.recordings||[]).filter(x=>x.id!=rid); saveUserData(); openMediaPanel();
  }));

  document.querySelectorAll('[data-media-open-proj]').forEach(b=>b.addEventListener('click', ()=>{
    const p = AppState.projects.find(x=>x.id==b.dataset.mediaOpenProj);
    if(p) openModal(`<h2>💾 ${escapeHtml(p.name)}</h2><p class="sub">${p.lang}</p><code class="codebox" style="display:block;white-space:pre-wrap;">${escapeHtml(p.code)}</code><button class="btn btn-ghost btn-sm" id="mb" style="margin-top:12px;">Back</button>`);
    document.getElementById('mb')?.addEventListener('click', openMediaPanel);
  }));

  document.querySelectorAll('[data-media-import-proj]').forEach(b=>b.addEventListener('click', ()=>{
    const p = AppState.projects.find(x=>x.id==b.dataset.mediaImportProj);
    if(!p) return;
    labLang = p.lang;
    labCodeDraft = p.code;
    editingProjectId = null;
    importedProjectOriginalName = p.name;
    toast(`📥 Imported "${p.name}" into Project Lab!`);
    openModal(renderLab());
  }));

  document.querySelectorAll('[data-media-del-proj]').forEach(b=>b.addEventListener('click', ()=>{
    const pid = b.dataset.mediaDelProj;
    AppState.projects = (AppState.projects||[]).filter(x=>x.id!=pid); saveUserData(); openMediaPanel();
  }));
}

function renderTalk(){
  const friends = sortedFriends();
  if(!friends.length){
    return `<h2>💬 Talk House</h2><p class="sub">You haven't added any friends yet. Visit the Contacts House, send a friend request, and once it's accepted you'll be able to chat here instantly.</p>`;
  }
  if(!activeFriendUid || !friends.some(f=>f.uid===activeFriendUid)) activeFriendUid = friends[0].uid;
  const friend = friends.find(f=>f.uid===activeFriendUid) || friends[0];
  const log = AppState.talkLog || [];
  return `
    <h2>💬 Talk House</h2>
    <div class="pill-row">${friends.map(f=>`<button class="pill ${f.uid===activeFriendUid?'active':''}" data-friend="${f.uid}">${pinnedFriends.has(f.uid)?'📌 ':''}${escapeHtml(f.name)} ${f.online?'🟢':''}</button>`).join('')}</div>
    <div class="row" style="margin:2px 0 8px;align-items:center;gap:4px;">
      <p class="sub" style="flex:1;margin:0;">${lastSeenLabel(friend)}</p>
      <button class="btn btn-ghost btn-sm" id="talk-media">📁 Media</button>
      <button class="btn btn-ghost btn-sm" id="talk-pin">${pinnedFriends.has(friend.uid)?'📌 Unpin':'📍 Pin'}</button>
      <button class="btn btn-ghost btn-sm" id="talk-share">🔗 Share</button>
      <button class="btn btn-ghost btn-sm" id="talk-select-toggle">${talkSelectMode ? 'Cancel' : 'Select'}</button>
      <button class="btn btn-ghost btn-sm" id="talk-help" style="padding:4px 8px;font-size:16px;" title="How To Use Talk House">❔</button>
      <button class="btn btn-sm" id="talk-delete-selected" style="background:#FF6F5E;color:#fff;margin-left:4px;display:${talkSelectMode && talkSelectedMsgs.size > 0 ? 'inline-block' : 'none'};">🗑️ Delete (${talkSelectedMsgs.size})</button>
    </div>
    <div class="chat-log" id="talk-log">${log.length? log.map((m, index)=>renderChatMessage(m, friend.name, index)).join('') : `<p class="sub">No messages yet — say hi to ${escapeHtml(friend.name)}!</p>`}</div>
    <div class="chat-row">
      <input class="inp" id="talk-input" placeholder="Message ${escapeHtml(friend.name)}...">
      <button class="btn btn-ghost btn-sm" id="talk-mic" title="Record a voice message">🎙️</button>
      <button class="btn btn-primary btn-sm" id="talk-send">Send</button>
    </div>
  `;
}

async function loadTalkLog(silent){
  if(!activeFriendUid) return;
  try{
    const res = await fetch('/api/messages/'+activeFriendUid);
    if(res.ok){
      const data = await res.json();
      const changed = JSON.stringify(data.messages) !== JSON.stringify(AppState.talkLog||[]);
      AppState.talkLog = data.messages || [];
      const friends = AppState.acceptedFriends||[];
      const friend = friends.find(f=>f.uid===activeFriendUid);
      registerReceivedMediaFromMessages(AppState.talkLog, friend);
      const log = document.getElementById('talk-log');
      if(log && changed){
        log.innerHTML = AppState.talkLog.length ? AppState.talkLog.map((m,index)=>renderChatMessage(m, friend?friend.name:'', index)).join('') : `<p class="sub">No messages yet — say hi!</p>`;
        log.scrollTop = log.scrollHeight;
      }
    }
  }catch(e){ /* offline — will retry on next poll */ }
}

async function ensureFriendsLoaded(){
  if(AppState.acceptedFriends) return;
  try{
    const res = await fetch('/api/friends/list');
    if(res.ok){
      const data = await res.json();
      AppState.incomingRequests = data.incoming_requests || [];
      AppState.acceptedFriends = data.friends || [];
      if(currentModalView==='talk' && overlay.style.display==='flex'){
        openModal(renderTalk());
      }
    }
  }catch(e){ /* offline */ }
}

function wireTalk(){
  clearInterval(talkPollTimer);
  ensureFriendsLoaded();

  const mediaBtn = document.getElementById('talk-media');
  if(mediaBtn) mediaBtn.addEventListener('click', openMediaPanel);

  const helpBtn = document.getElementById('talk-help');
  if(helpBtn) helpBtn.addEventListener('click', ()=>{
    openModal(`
      <h2>💬 How To Use Talk House</h2>
      <div class="item-card" style="text-align:left;line-height:1.6;">
        <p><b>✓ Send Message:</b> Type in the chat input and click Send or press Enter.</p>
        <p><b>✓ Send Voice Message:</b> Click 🎙️ to start recording, speak your audio, then click 🎙️ again to auto-send.</p>
        <p><b>✓ Share Multiple Files:</b> Open Media Panel → Section 1, check multiple items, click Share, select multiple friends, and hit Share with Selected Friends.</p>
        <p><b>✓ Receiving Media:</b> All photos, videos, files, projects, and voice recordings sent by friends automatically appear in Media Panel → Section 2 (Received Media).</p>
        <p><b>✓ Importing Projects:</b> Tap any shared project card in chat or Received Media and click 📥 Import To Project Lab to view, edit, and run the code.</p>
        <p><b>✓ Using Media Panel:</b> Manage saved photos, recordings, documents, and projects in one organized hub.</p>
        <p><b>✓ Pin Friends &amp; Delete Messages:</b> Click 📍 Pin to prioritize friends, or use 🗑️ Delete and multi-select to manage chat history.</p>
      </div>
      <button class="btn btn-ghost btn-sm" id="help-back" style="margin-top:12px;">← Back to Talk House</button>
    `);
    const backBtn = document.getElementById('help-back');
    if(backBtn) backBtn.addEventListener('click', ()=>{ openModal(renderTalk()); });
  });

  document.querySelectorAll('[data-friend]').forEach(b=>b.addEventListener('click', ()=>{
    activeFriendUid=b.dataset.friend;
    talkSelectedMsgs.clear();
    talkSelectMode = false;
    openModal(renderTalk());
  }));
  const sendBtn=document.getElementById('talk-send');
  if(sendBtn) sendBtn.addEventListener('click', sendTalk);
  const input=document.getElementById('talk-input');
  if(input) input.addEventListener('keydown', e=>{ if(e.key==='Enter') sendTalk(); });

  const pinBtn=document.getElementById('talk-pin');
  if(pinBtn) pinBtn.addEventListener('click', ()=>{
    if(!activeFriendUid) return;
    if(pinnedFriends.has(activeFriendUid)) pinnedFriends.delete(activeFriendUid);
    else pinnedFriends.add(activeFriendUid);
    savePinnedFriends(pinnedFriends);
    saveUserData(); // pinnedFriends is also mirrored in the main userdata blob, which is what loadUserData() actually restores on refresh — without this the pin is lost until some unrelated action happens to save first
    openModal(renderTalk());
  });

  const selectToggleBtn=document.getElementById('talk-select-toggle');
  if(selectToggleBtn) selectToggleBtn.addEventListener('click', ()=>{
    talkSelectMode = !talkSelectMode;
    talkSelectedMsgs.clear();
    openModal(renderTalk());
  });

  document.querySelectorAll('.talk-msg-chk').forEach(chk=>{
    chk.addEventListener('change', ()=>{
      const msgId = parseInt(chk.dataset.msgId);
      if(chk.checked) talkSelectedMsgs.add(msgId);
      else talkSelectedMsgs.delete(msgId);
      const delBtn = document.getElementById('talk-delete-selected');
      if(delBtn) {
        delBtn.style.display = talkSelectedMsgs.size > 0 ? 'inline-block' : 'none';
        delBtn.textContent = `🗑️ Delete Selected (${talkSelectedMsgs.size})`;
      }
    });
  });

  const deleteSelBtn=document.getElementById('talk-delete-selected');
  if(deleteSelBtn) deleteSelBtn.addEventListener('click', ()=>{
    if(!talkSelectedMsgs.size) return;
    const msgs = AppState.talkLog || [];
    const selectedMsgs = msgs.filter(m => talkSelectedMsgs.has(m.id));
    const ownSelected = selectedMsgs.some(m => m.from === 'me');
    openModal(`
      <h2>🗑️ Delete Messages</h2>
      <p class="sub">Delete ${talkSelectedMsgs.size} selected message(s)?</p>
      <div class="btn-row" style="margin-top:12px;">
        <button class="btn btn-sm btn-primary" id="del-confirm-me">Delete for Me</button>
        ${ownSelected ? `<button class="btn btn-sm" style="background:#FF6F5E;color:#fff;" id="del-confirm-everyone">Delete for Everyone</button>` : ''}
        <button class="btn btn-ghost btn-sm" id="del-cancel">Cancel</button>
      </div>
    `);
    
    document.getElementById('del-confirm-me').addEventListener('click', async ()=>{
      try {
        const res = await fetch('/api/messages/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ msg_ids: Array.from(talkSelectedMsgs), mode: 'me' })
        });
        if(res.ok) {
          toast('🗑️ Messages deleted.');
          talkSelectedMsgs.clear();
          talkSelectMode = false;
        } else {
          toast('Failed to delete messages.');
        }
      } catch(err) {
        toast('Network error.');
      }
      openModal(renderTalk());
    });

    if(ownSelected) {
      document.getElementById('del-confirm-everyone').addEventListener('click', async ()=>{
        try {
          const res = await fetch('/api/messages/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ msg_ids: Array.from(talkSelectedMsgs), mode: 'everyone' })
          });
          if(res.ok) {
            toast('🗑️ Messages deleted for everyone.');
            talkSelectedMsgs.clear();
            talkSelectMode = false;
          } else {
            toast('Failed to delete messages.');
          }
        } catch(err) {
          toast('Network error.');
        }
        openModal(renderTalk());
      });
    }

    document.getElementById('del-cancel').addEventListener('click', ()=>{
      openModal(renderTalk());
    });
  });

  const shareBtn=document.getElementById('talk-share');
  if(shareBtn) shareBtn.addEventListener('click', openSharePicker);

  const micBtn=document.getElementById('talk-mic');
  if(micBtn) micBtn.addEventListener('click', toggleVoiceRecording);

  const logEl=document.getElementById('talk-log');
  if(logEl) logEl.addEventListener('click', (e)=>{
    const card = e.target.closest('[data-open-share]');
    if(!card) return;
    const idx = parseInt(card.dataset.openShare);
    const m = AppState.talkLog[idx];
    if(!m) return;
    let payload=null;
    try{ payload = JSON.parse(m.text); }catch(err){}
    openSharedContent(payload);
  });

  loadTalkLog();
  talkPollTimer = setInterval(()=>{
    if(document.getElementById('talk-log')) loadTalkLog(true);
    else clearInterval(talkPollTimer);
  }, 4000);
}
async function sendTalk(){
  const input=document.getElementById('talk-input');
  const v=input.value.trim(); if(!v || !activeFriendUid) return;
  input.value='';
  input.disabled=true;
  try{
    const res = await fetch('/api/messages/'+activeFriendUid, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text:v})});
    if(res.ok){ Audio_.messageSent(); await loadTalkLog(); }
    else { const data=await res.json(); toast(data.error||'Could not send message.'); }
  }catch(e){ toast('Network error — is the server running?'); }
  input.disabled=false; input.focus();
}

let sharePickerPhotoSelected = new Set();
function openSharePicker(){
  const projects = AppState.projects||[];
  const interviews = AppState.interview.history||[];
  const skills = Object.entries(AppState.quiz.completed||{});
  const recordings = AppState.recordings||[];
  const photos = AppState.photos||[];
  sharePickerPhotoSelected = new Set();
  const section=(title, items, kindLabel)=> items.length ? `<h3>${title}</h3>${items}` : `<h3>${title}</h3><p class="sub">Nothing to share yet.</p>`;
  openModal(`
    <h2>🔗 Share with ${escapeHtml((sortedFriends().find(f=>f.uid===activeFriendUid)||{}).name||'friend')}</h2>
    ${photos.length ? `<h3>Photos</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:8px;margin-bottom:8px;">
        ${photos.map(p=>`<label style="position:relative;cursor:pointer;">
          <img loading="lazy" src="${p.dataUrl}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:2px solid var(--border);">
          <input type="checkbox" data-select-share-photo="${p.id}" style="position:absolute;top:4px;right:4px;width:18px;height:18px;">
        </label>`).join('')}
      </div>
      <button class="btn btn-sm btn-primary" id="share-photos-btn" disabled>📤 Share Selected Photos</button>` : `<h3>Photos</h3><p class="sub">Nothing to share yet.</p>`}
    ${section('My Projects', projects.map(p=>`<div class="item-card"><div class="row"><span class="icon">💾</span><div style="flex:1;"><b>${escapeHtml(p.name)}</b><div class="sub">${p.lang}</div></div><button class="btn btn-sm btn-primary" data-share-project="${p.id}">Share</button></div></div>`).join(''))}
    ${section('Interview Reports', interviews.map((r,i)=>`<div class="item-card"><div class="row"><span class="icon">🎤</span><div style="flex:1;"><b>${r.type} — ${r.score}/100</b><div class="sub">${r.date}</div></div><button class="btn btn-sm btn-primary" data-share-interview="${i}">Share</button></div></div>`).join(''))}
    ${section('Skills Reports', skills.map(([topic,pct])=>`<div class="item-card"><div class="row"><span class="icon">📘</span><div style="flex:1;"><b>${escapeHtml(topic)}</b><div class="sub">${pct}%</div></div><button class="btn btn-sm btn-primary" data-share-skill="${escapeHtml(topic)}">Share</button></div></div>`).join(''))}
    ${section('Recordings', recordings.map(r=>`<div class="item-card"><div class="row"><span class="icon">🎥</span><div style="flex:1;"><b>${escapeHtml(r.name)}</b></div><button class="btn btn-sm btn-primary" data-share-recording="${r.id}">Share</button></div></div>`).join(''))}
    <p class="sub" style="margin-top:8px;">Note: projects, reports, and recordings live in your browser session, so shared cards send a preview snapshot rather than the original live file.</p>
    <button class="btn btn-ghost btn-sm" id="share-cancel" style="margin-top:8px;">Cancel</button>
  `);
  document.getElementById('share-cancel').addEventListener('click', ()=>{ openModal(renderTalk()); });
  document.querySelectorAll('[data-select-share-photo]').forEach(cb=>cb.addEventListener('change', ()=>{
    const id = cb.dataset.selectSharePhoto;
    if(cb.checked) sharePickerPhotoSelected.add(id); else sharePickerPhotoSelected.delete(id);
    const btn = document.getElementById('share-photos-btn');
    if(btn) btn.disabled = sharePickerPhotoSelected.size === 0;
  }));
  document.getElementById('share-photos-btn')?.addEventListener('click', async (e)=>{
    if(!sharePickerPhotoSelected.size) return;
    const btn = e.target; btn.disabled = true; btn.textContent = 'Sharing...';
    for(const id of sharePickerPhotoSelected){
      const p = photos.find(x=>String(x.id)===String(id));
      if(p) await sendSharePayload({kind:'photo', title:'Interview Photo', subtitle:(p.date||'')+' '+(p.time||''), dataUrl:p.dataUrl});
    }
  });
  document.querySelectorAll('[data-share-project]').forEach(b=>b.addEventListener('click', ()=>{
    const p = AppState.projects.find(x=>x.id==b.dataset.shareProject);
    if(p) sendSharePayload({kind:'project', title:p.name, subtitle:p.lang+' • '+p.code.slice(0,80).replace(/\n/g,' ')+'...', lang:p.lang, code:p.code});
  }));
  document.querySelectorAll('[data-share-interview]').forEach(b=>b.addEventListener('click', ()=>{
    const r = AppState.interview.history[parseInt(b.dataset.shareInterview)];
    if(r) sendSharePayload({kind:'interview', title:r.type+' Interview — '+r.score+'/100', subtitle:r.date, score:r.score, feedback:r.feedback, transcript:r.transcript||[]});
  }));
  document.querySelectorAll('[data-share-skill]').forEach(b=>b.addEventListener('click', ()=>{
    const topic=b.dataset.shareSkill; const pct=AppState.quiz.completed[topic];
    sendSharePayload({kind:'skills', title:topic+' Quiz', subtitle:pct+'% score', topic, pct});
  }));
  document.querySelectorAll('[data-share-recording]').forEach(b=>b.addEventListener('click', ()=>{
    const r = (AppState.recordings||[]).find(x=>x.id==b.dataset.shareRecording);
    if(r) sendSharePayload({kind:'recording', title:r.name, subtitle:(r.size/1024).toFixed(0)+' KB', size:r.size, url:r.url});
  }));
}

function openSharedContent(payload){
  if(!payload) return;
  if(payload.kind==='project'){
    openModal(`<h2>💾 ${escapeHtml(payload.title)}</h2><p class="sub">${escapeHtml(payload.lang||'')}</p>
      <code class="codebox" style="display:block;white-space:pre-wrap;text-align:left;">${escapeHtml(payload.code||'(no code included)')}</code>
      <div class="btn-row" style="margin-top:12px;gap:8px;">
        <button class="btn btn-primary btn-sm" id="share-import-proj">📥 Import To Project Lab</button>
        <button class="btn btn-ghost btn-sm" id="share-view-back">← Back to Talk House</button>
      </div>`);
    document.getElementById('share-import-proj')?.addEventListener('click', ()=>{
      labLang = payload.lang || 'javascript';
      labCodeDraft = payload.code || '';
      editingProjectId = null;
      importedProjectOriginalName = payload.title || 'shared_project';
      toast(`📥 Imported "${payload.title}" into Project Lab!`);
      openModal(renderLab());
    });
  } else if(payload.kind==='interview'){
    openModal(`<h2>🎤 ${escapeHtml(payload.title)}</h2><p class="sub">${escapeHtml(payload.subtitle||'')} · Score: <b>${payload.score ?? '—'}/100</b></p>
      <div class="item-card" style="white-space:pre-wrap;text-align:left;">${escapeHtml(payload.feedback||'No feedback included.')}</div>
      <h3>Transcript</h3>
      <div class="chat-log" style="text-align:left;">${(payload.transcript||[]).map(m=>`<div class="msg ${m.role==='user'?'user':'ai'}"><b>${m.role==='user'?'Candidate':'AI Interviewer'}:</b> ${escapeHtml(m.text)}</div>`).join('') || '<p class="sub">No transcript included.</p>'}</div>
      <button class="btn btn-ghost btn-sm" id="share-view-back" style="margin-top:12px;">← Back to Talk House</button>`);
  } else if(payload.kind==='skills'){
    openModal(`<h2>📘 ${escapeHtml(payload.title)}</h2>
      <div class="stat-box" style="max-width:160px;"><div class="n">${payload.pct ?? '—'}%</div><div class="l">Score</div></div>
      <button class="btn btn-ghost btn-sm" id="share-view-back" style="margin-top:12px;">← Back to Talk House</button>`);
  } else if(payload.kind==='photo'){
    if(payload.url){
      openModal(`<h2>📷 ${escapeHtml(payload.title||'Shared Photo')}</h2><p class="sub">${escapeHtml(payload.subtitle||'')}</p>
        <img loading="lazy" src="${payload.url}" style="max-width:100%;border-radius:12px;margin-top:8px;">
        <div class="btn-row" style="margin-top:12px;gap:8px;">
          <a class="btn btn-outline btn-sm" href="${payload.url}" download="shared_photo.jpg">⬇ Download</a>
          <button class="btn btn-ghost btn-sm" id="share-view-back">← Back to Talk House</button>
        </div>`);
    } else {
      openModal(`<h2>📷 ${escapeHtml(payload.title||'Shared Photo')}</h2><p class="sub">${escapeHtml(payload.subtitle||'')}</p>
        <p>This photo couldn't be loaded — ask the sender to try sharing it again.</p>
        <button class="btn btn-ghost btn-sm" id="share-view-back" style="margin-top:12px;">← Back to Talk House</button>`);
    }
  } else if(payload.kind==='recording'){
    if(payload.url){
      openModal(`<h2>🎥 ${escapeHtml(payload.title)}</h2><p class="sub">${escapeHtml(payload.subtitle||'')}</p>
        <video class="cam" style="margin-top:8px;max-width:100%;" controls src="${payload.url}"></video>
        <button class="btn btn-ghost btn-sm" id="share-view-back" style="margin-top:12px;">← Back to Talk House</button>`);
    } else {
      openModal(`<h2>🎥 ${escapeHtml(payload.title)}</h2><p class="sub">${escapeHtml(payload.subtitle||'')}</p>
        <p>This recording lives in the sender's browser session, so it can't be streamed to you directly here — ask them to use Talk House's Share again if you'd like an updated snapshot, or have them download and send it to you another way.</p>
        <button class="btn btn-ghost btn-sm" id="share-view-back" style="margin-top:12px;">← Back to Talk House</button>`);
    }
  } else {
    openModal(`<h2>📎 ${escapeHtml(payload.title||'Shared content')}</h2><p class="sub">${escapeHtml(payload.subtitle||'')}</p>
      <button class="btn btn-ghost btn-sm" id="share-view-back" style="margin-top:12px;">← Back to Talk House</button>`);
  }
  const back=document.getElementById('share-view-back');
  if(back) back.addEventListener('click', ()=>{ openModal(renderTalk()); });
}
async function uploadPhotoDataUrl(dataUrl){
  if(!dataUrl || !dataUrl.startsWith('data:image/')) return null;
  try{
    const res = await fetch('/api/photos/upload', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({dataUrl})
    });
    if(res.ok){ const data = await res.json(); return data.url || null; }
  }catch(e){ /* offline — caller falls back gracefully */ }
  return null;
}
async function sendSharePayload(payload){
  if(!activeFriendUid) return;
  // Photos are captured client-side as base64 data URLs, which are far too
  // large to fit in a chat message (content is capped at 4000 chars server
  // side). Upload the photo first and share a short URL instead.
  if(payload.kind==='photo' && payload.dataUrl && !payload.url){
    const uploadedUrl = await uploadPhotoDataUrl(payload.dataUrl);
    if(!uploadedUrl){ toast('Could not upload photo — try again.'); return; }
    payload = {...payload, url: uploadedUrl, dataUrl: undefined};
  }
  try{
    const res = await fetch('/api/messages/'+activeFriendUid, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({text: JSON.stringify(payload), attachmentType:'share'})
    });
    if(res.ok){ Audio_.messageSent(); toast('🔗 Shared.'); openModal(renderTalk()); }
    else { const data=await res.json(); toast(data.error||'Could not share.'); }
  }catch(e){ toast('Network error — is the server running?'); }
}

/* ---- Voice messages: record a short clip, upload, and send ---- */
let voiceRecorder=null, voiceChunks=[], voiceStream=null;
async function toggleVoiceRecording(){
  const micBtn=document.getElementById('talk-mic');
  if(voiceRecorder && voiceRecorder.state==='recording'){
    voiceRecorder.stop();
    return;
  }
  try{
    voiceStream = await navigator.mediaDevices.getUserMedia({audio:true});
  }catch(e){ toast('🎙️ Microphone permission denied.'); return; }
    voiceChunks=[];
  voiceRecorder = new MediaRecorder(voiceStream);
  voiceRecorder.ondataavailable = e=>voiceChunks.push(e.data);
  voiceRecorder.onstop = async ()=>{
    voiceStream.getTracks().forEach(t=>t.stop()); voiceStream=null;
    if(micBtn){ micBtn.textContent='🎙️'; micBtn.disabled=true; }
    const blob = new Blob(voiceChunks, {type:'audio/webm'});
    const fd = new FormData(); fd.append('audio', blob, 'voice-message.webm');
    try{
      const res = await fetch('/api/messages/'+activeFriendUid+'/voice', {method:'POST', body:fd});
      if(res.ok){ Audio_.messageSent(); toast('🎙️ Voice message sent.'); await loadTalkLog(); }
      else { const data=await res.json(); toast(data.error||'Could not send voice message.'); }
    }catch(e){ toast('Network error — is the server running?'); }
    if(micBtn) micBtn.disabled=false;
  };
  voiceRecorder.start();
  if(micBtn) micBtn.textContent='⏹';
  toast('🎙️ Recording voice message — click again to send.');
}

/* ============================================================
   BUILDING 7 — CONTACTS HOUSE
   ============================================================ */
let contactsTab = 'browse';
let contactsMultiSelect = false;
let contactsSelected = new Set();
let contactsLoading = false;
let contactsRenderToken = 0;
let contactsSearchQuery = '';

function bumpContactsToken(){ return ++contactsRenderToken; }
function renderContactsNow(){
  openAndWireContacts(false);
}
function openAndWireContacts(shouldFetch = false){
  bumpContactsToken();
  openModal(renderContacts());
  wireContacts(shouldFetch);
}
function contactAvatar(d){
  return renderAvatarHtml(d);
}
function lastSeenLabel(d){
  if(d.online) return '<span class="status-dot online"></span>Online';
  if(!d.lastSeen) return '<span class="status-dot offline"></span>Offline';
  return `<span class="status-dot offline"></span>Last seen ${timeAgo(d.lastSeen)}`;
}
function timeAgo(iso){
  try{
    const then = new Date(iso.replace(' ','T')+'Z').getTime();
    const mins = Math.max(0, Math.round((Date.now()-then)/60000));
    if(mins<1) return 'just now';
    if(mins<60) return mins+'m ago';
    const hrs=Math.round(mins/60);
    if(hrs<24) return hrs+'h ago';
    return Math.round(hrs/24)+'d ago';
  }catch(e){ return ''; }
}
function renderContacts(){
  const real = AppState.realDirectory || [];
  const incoming = AppState.incomingRequests||[];
  const friendsList = AppState.acceptedFriends||[];

  const browseItems = real.map(d=>{
    const isFriend = friendsList.some(f=>f.uid===d.uid);
    const requested = AppState.sentRequests && AppState.sentRequests.has(d.uid);
    const btn = isFriend ? `<button class="btn btn-sm btn-ghost" disabled>✓ Friends</button>`
      : requested ? `<button class="btn btn-sm btn-ghost" disabled>Requested</button> <button class="btn btn-sm btn-outline" data-cancel-request="${d.uid}" style="color:#FF6F5E;border-color:#FF6F5E;">Delete</button>`
      : `<button class="btn btn-sm btn-primary" data-request="${d.uid}">Add Friend</button>`;
    const skillsList = (d.skills||'').split(',').map(s=>s.trim()).filter(Boolean);
    return `<div class="contact-card" data-search="${escapeHtml((d.name+' '+d.uid+' '+skillsList.join(' ')+' '+(d.city||'')).toLowerCase())}">
      <div class="contact-avatar">${contactAvatar(d)}</div>
      <div class="contact-info">
        <b>${escapeHtml(d.name)}</b>
        <div class="sub">${d.uid}${d.city?' · '+escapeHtml(d.city):''}</div>
        <div class="sub">${lastSeenLabel(d)}</div>
      </div>
      <div style="margin-left:auto;">${btn}</div>
    </div>`;
  }).join('') || '<p class="sub">No directory entries found.</p>';

  const requestItems = incoming.length ? incoming.map(r=>`
    <div class="contact-card">
      <div class="contact-avatar">${contactAvatar(r)}</div>
      <div class="contact-info">
        <b>${escapeHtml(r.name)}</b>
        <div class="sub">${r.uid}${r.city?' · '+escapeHtml(r.city):''}</div>
      </div>
      <div class="btn-row" style="margin-left:auto;gap:4px;">
        <button class="btn btn-sm btn-primary" data-respond="${r.request_id}:accept">Accept</button>
        <button class="btn btn-sm btn-outline" data-respond="${r.request_id}:reject">Decline</button>
      </div>
    </div>
  `).join('') : '<p class="sub">No pending friend requests.</p>';

  const friendItems = friendsList.length ? friendsList.map(f=>{
    const isChecked = contactsSelected.has(f.uid);
    const isPinned = pinnedFriends.has(f.uid);
    const deleteBtnHtml = isPinned
      ? `<button class="btn btn-sm btn-outline btn-disabled-pinned" data-remove-friend="${f.uid}" title="Please unpin this friend before deleting">📌 Pinned</button>`
      : `<button class="btn btn-sm btn-outline" data-remove-friend="${f.uid}" style="color:#FF6F5E;border-color:#FF6F5E;">Remove</button>`;

    return `<div class="contact-card" data-profile-uid="${f.uid}" style="cursor:pointer;">
      <div class="row" style="align-items:center;width:100%;">
        ${contactsMultiSelect ? `<input type="checkbox" data-select-friend="${f.uid}" ${isChecked?'checked':''} style="width:18px;height:18px;margin-right:10px;cursor:pointer;">` : ''}
        <div class="contact-avatar">${contactAvatar(f)}</div>
        <div class="contact-info" style="flex:1;">
          <b>${escapeHtml(f.name)} ${isPinned ? '📌' : ''}</b>
          <div class="sub">${f.uid}${f.city?' · '+escapeHtml(f.city):''}</div>
          <div class="sub">${lastSeenLabel(f)}</div>
        </div>
        ${!contactsMultiSelect ? `
          <div class="btn-row" style="margin-left:auto;gap:4px;">
            <button class="btn btn-sm btn-primary" data-chat="${f.uid}">💬 Chat</button>
            ${deleteBtnHtml}
          </div>
        ` : ''}
      </div>
    </div>`;
  }).join('') : '<p class="sub">No friends yet — browse S2 Talk members and send a request.</p>';

  return `
    <h2>👥 Contacts House</h2>
    <p class="sub">Your ID: <b>${AppState.current.uid}</b> — share it so others can find you.</p>
    <div class="pill-row">
      <button class="pill ${contactsTab==='browse'?'active':''}" data-tab="browse">Browse</button>
      <button class="pill ${contactsTab==='requests'?'active':''}" data-tab="requests">Requests ${incoming.length?`(${incoming.length})`:''}</button>
      <button class="pill ${contactsTab==='friends'?'active':''}" data-tab="friends">My Friends (${friendsList.length})</button>
    </div>
    <div id="contacts-browse" style="${contactsTab==='browse'?'':'display:none;'}">
      <div class="pill-row" style="gap:6px;">
        <input class="inp" id="contact-search" placeholder="Search by name, unique ID, skill, or city..." style="flex:1;" value="${escapeHtml(contactsSearchQuery)}">
        <button class="btn btn-primary btn-sm" id="contact-search-btn">🔍 Search</button>
      </div>
      <div id="contact-list" style="margin-top:12px;">${browseItems}</div>
    </div>
    <div id="contacts-requests" style="${contactsTab==='requests'?'':'display:none;'}margin-top:12px;">${requestItems}</div>
    <div id="contacts-friends" style="${contactsTab==='friends'?'':'display:none;'}margin-top:12px;">
      ${friendsList.length ? `<div class="pill-row" style="margin-top:0;">
        <button class="btn btn-ghost btn-sm" id="friends-select-toggle">${contactsMultiSelect?'Cancel':'☑ Select'}</button>
        ${contactsMultiSelect ? `<button class="btn btn-sm" style="background:#FF6F5E;color:#fff;" id="friends-delete-selected" ${contactsSelected.size?'':'disabled'}>🗑️ Delete Selected (${contactsSelected.size})</button>` : ''}
      </div>` : ''}
      ${friendItems}
    </div>
  `;
}
async function refreshDirectoryAndRerender(){
  if(!AppState.realDirectory) contactsLoading = true;
  const myToken = contactsRenderToken;
  try{
    const [dirRes, friendsRes] = await Promise.all([fetch('/api/directory'), fetch('/api/friends/list')]);
    if(dirRes.ok){ AppState.realDirectory = (await dirRes.json()).users || []; }
    if(friendsRes.ok){
      const fdata = await friendsRes.json();
      const prevIds = new Set((AppState.incomingRequests||[]).map(r=>r.request_id));
      const incoming = fdata.incoming_requests || [];
      incoming.filter(r=>!prevIds.has(r.request_id)).forEach(r=>pushNotification(`📨 New friend request from ${r.name}`));
      AppState.incomingRequests = incoming;
      AppState.acceptedFriends = fdata.friends || [];
    }
  }catch(e){ /* backend not reachable */ }
  contactsLoading = false;
  if(myToken !== contactsRenderToken) return;
  if(currentModalView==='contacts' && overlay.style.display==='flex'){
    openAndWireContacts(false);
  }
}
function wireContacts(shouldFetch){
  if(!AppState.sentRequests) AppState.sentRequests = new Set();
  if(shouldFetch !== false) refreshDirectoryAndRerender();

  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click', ()=>{
    contactsTab = b.dataset.tab;
    contactsMultiSelect = false; contactsSelected = new Set();
    saveUserData();
    openAndWireContacts(false);
  }));

  let searchDebounce=null;
  function runSearchLocal(){
    const q = contactsSearchQuery.toLowerCase().trim();
    document.querySelectorAll('#contact-list .contact-card').forEach(card=>{
      card.style.display = !q || (card.dataset.search||'').includes(q) ? '' : 'none';
    });
  }
  async function runSearchServer(){
    const q = contactsSearchQuery;
    const myToken = bumpContactsToken();
    try{
      const res = await fetch('/api/directory'+(q?`?q=${encodeURIComponent(q)}`:''));
      if(res.ok && myToken === contactsRenderToken){
        AppState.realDirectory = (await res.json()).users || [];
        const activeEl = document.activeElement;
        const caret = activeEl && activeEl.id==='contact-search' ? activeEl.selectionStart : null;
        openAndWireContacts(false);
        const newInput = document.getElementById('contact-search');
        if(newInput && caret!==null){ newInput.value=q; newInput.focus(); newInput.setSelectionRange(caret, caret); }
      } else if(res.ok){
        AppState.realDirectory = (await res.json()).users || [];
      }
    }catch(e){ runSearchLocal(); }
  }
  const search=document.getElementById('contact-search');
  if(search) search.addEventListener('input', ()=>{
    contactsSearchQuery = search.value;
    runSearchLocal();
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(runSearchServer, 300);
  });
  const searchBtn=document.getElementById('contact-search-btn');
  if(searchBtn) searchBtn.addEventListener('click', (e)=>{ e.preventDefault(); clearTimeout(searchDebounce); runSearchServer(); });

  runSearchLocal();

  document.querySelectorAll('[data-request]').forEach(b=>b.addEventListener('click', async (e)=>{
    e.preventDefault();
    e.stopPropagation();
    const uid=b.dataset.request;
    if(b.disabled) return;
    b.disabled=true; b.textContent='Requested';
    if(!AppState.sentRequests) AppState.sentRequests = new Set();
    AppState.sentRequests.add(uid);
    unlockAchievement('social'); addXP(5); toast('📨 Friend request sent.');
    openAndWireContacts(false);
    
    // Async background sync
    try{
      const res=await fetch('/api/friends/request', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
      if(!res.ok){
        const data=await res.json().catch(()=>({}));
        AppState.sentRequests.delete(uid);
        toast(data.error||'Could not send request.');
        openAndWireContacts(false);
      }
    }catch(err){
      AppState.sentRequests.delete(uid);
      toast('Network error.');
      openAndWireContacts(false);
    }
  }));

  document.querySelectorAll('[data-cancel-request]').forEach(b=>b.addEventListener('click', (e)=>{
    e.preventDefault();
    e.stopPropagation();
    const uid = b.dataset.cancelRequest;
    if(AppState.sentRequests) AppState.sentRequests.delete(uid);
    toast('🗑️ Request removed.');
    openAndWireContacts(false);
  }));

  document.querySelectorAll('[data-respond]').forEach(b=>b.addEventListener('click', async (e)=>{
    e.preventDefault();
    e.stopPropagation();
    const [request_id, action]=b.dataset.respond.split(':');
    const reqIdNum = parseInt(request_id);
    const reqObj = (AppState.incomingRequests||[]).find(r=>r.request_id===reqIdNum);
    
    // Instant optimistic local update
    AppState.incomingRequests = (AppState.incomingRequests||[]).filter(r=>r.request_id!==reqIdNum);
    if(action==='accept' && reqObj){
      if(!AppState.acceptedFriends) AppState.acceptedFriends = [];
      if(!AppState.acceptedFriends.some(f=>f.uid===reqObj.uid)){
        AppState.acceptedFriends.unshift({
          uid: reqObj.uid, name: reqObj.name, skills: reqObj.skills||'', city: reqObj.city||'',
          pic: reqObj.pic, avatarEmoji: reqObj.avatarEmoji, online: reqObj.online||false
        });
      }
      unlockAchievement('social'); addXP(10); Audio_.notification();
      toast('👥 Friend request accepted — they now appear in Talk House.');
    } else {
      toast('Request declined.');
    }
    openAndWireContacts(false);

    // Async background sync
    try{
      await fetch('/api/friends/respond', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({request_id:reqIdNum, action})});
    }catch(err){}
  }));

  document.querySelectorAll('[data-chat]').forEach(b=>b.addEventListener('click', ()=>{
    activeFriendUid = b.dataset.chat;
    const b2=buildings.find(x=>x.id==='talk');
    if(b2) visitBuilding(b2);
  }));

  document.querySelectorAll('[data-remove-friend]').forEach(b=>b.addEventListener('click', async (e)=>{
    e.preventDefault();
    e.stopPropagation();
    const uid=b.dataset.removeFriend;
    if(pinnedFriends.has(uid)){
      toast('📍 This friend is currently pinned. Please unpin the friend first.');
      return;
    }
    if(!confirm('Remove this friend?')) return;
    b.disabled=true;
    
    // Instant optimistic local update
    AppState.acceptedFriends = (AppState.acceptedFriends||[]).filter(x=>x.uid!==uid);
    toast('🗑️ Friend removed.');
    openAndWireContacts(false);

    // Async background sync
    try{
      await fetch('/api/friends/remove', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
    }catch(err){}
  }));


  const selectToggle=document.getElementById('friends-select-toggle');
  if(selectToggle) selectToggle.addEventListener('click', ()=>{
    contactsMultiSelect = !contactsMultiSelect;
    contactsSelected = new Set();
    renderContactsNow();
  });

  if(contactsMultiSelect){
    document.querySelectorAll('#contacts-friends .contact-card').forEach(card => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const cb = card.querySelector('[data-select-friend]');
        if(cb){
          cb.checked = !cb.checked;
          const uid = cb.dataset.selectFriend;
          if(cb.checked) contactsSelected.add(uid); else contactsSelected.delete(uid);
          card.classList.toggle('selected', cb.checked);
          const delBtn = document.getElementById('friends-delete-selected');
          if(delBtn) {
            delBtn.disabled = contactsSelected.size === 0;
            delBtn.textContent = `🗑️ Delete Selected (${contactsSelected.size})`;
          }
        }
      });
    });
  }

  document.querySelectorAll('[data-select-friend]').forEach(cb=>cb.addEventListener('change', (e)=>{
    e.stopPropagation();
    const uid=cb.dataset.selectFriend;
    if(cb.checked) contactsSelected.add(uid); else contactsSelected.delete(uid);
    const delBtn = document.getElementById('friends-delete-selected');
    if(delBtn) {
      delBtn.disabled = contactsSelected.size === 0;
      delBtn.textContent = `🗑️ Delete Selected (${contactsSelected.size})`;
    }
  }));
  const deleteSelBtn=document.getElementById('friends-delete-selected');
  if(deleteSelBtn) deleteSelBtn.addEventListener('click', async ()=>{
    if(!contactsSelected.size) return;
    if(!confirm(`Remove ${contactsSelected.size} selected friend(s)? This can't be undone.`)) return;
    deleteSelBtn.disabled=true; deleteSelBtn.textContent='Removing...';
    const uids=[...contactsSelected];
    let failed=0;
    for(const uid of uids){
      try{
        const res=await fetch('/api/friends/remove', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
        if(!res.ok) failed++;
      }catch(e){ failed++; }
    }
    toast(failed ? `Removed ${uids.length-failed} friend(s) — ${failed} failed.` : `🗑️ Removed ${uids.length} friend(s).`);
    contactsMultiSelect=false; contactsSelected=new Set();
    await refreshDirectoryAndRerender();
  });
}

/* ============================================================
   BUILDING 8 — ABOUT & SETTINGS HOUSE
   ============================================================ */
const AVATAR_OPTS=['🙂','😎','🧑‍💻','🧑‍🎓','🦸','🧙','🤖','🐱'];
const CAR_COLORS=['#5B4FE8','#FF6F5E','#1FBFA0','#FFB648','#2C2E63','#E23FA0'];
function renderSettings(){
  const u = AppState.current;
  const picHtml = renderAvatarHtml(u);
  return `
    <h2>⚙️ About &amp; Settings House</h2>

    <h3>Personal Information</h3>
    <div class="profile-card">
      <div class="profile-card-photo" id="pi-photo">${picHtml}</div>
      <div class="profile-card-info">
        <div class="row"><b>Name</b><span>${escapeHtml(u.name)}</span></div>
        <div class="row"><b>Unique ID</b><span>${u.uid}</span></div>
        <div class="row"><b>Email</b><span>${escapeHtml(u.email)}</span></div>
        <div class="row"><b>Bio</b><span>${escapeHtml(u.bio||'—')}</span></div>
        <div class="row"><b>Skills</b><span>${escapeHtml(u.skills||'—')}</span></div>
        <div class="row"><b>Interests</b><span>${escapeHtml(u.interests||'—')}</span></div>
        <div class="row"><b>City</b><span>${escapeHtml(u.city||'—')}</span></div>
        <div class="row"><b>Resume</b><span>${u.resumeFileName ? escapeHtml(u.resumeFileName) : 'Not uploaded'}</span></div>
      </div>
    </div>
    <button class="btn btn-primary btn-sm" id="open-edit-profile" style="margin-top:10px;">✏️ Edit Profile</button>

    <div class="btn-row" style="margin-top:16px;">
      <button class="btn btn-outline btn-sm" id="acct-change-pass">Change Password</button>
      <button class="btn btn-outline btn-sm" id="acct-logout">Logout</button>
      <button class="btn btn-sm" style="background:#FF6F5E;color:#fff;" id="acct-delete">Delete Account</button>
    </div>

    <h3>Avatar Settings</h3>
    <div class="avatar-picker">${AVATAR_OPTS.map(a=>`<div class="pick-opt ${a===AppState.avatarEmoji?'sel':''}" data-avatar="${a}">${a}</div>`).join('')}</div>

    <h3>Vehicle Settings</h3>
    <div class="color-picker">${CAR_COLORS.map(c=>`<div class="color-opt ${c===AppState.carColor?'sel':''}" style="background:${c}" data-color="${c}"></div>`).join('')}</div>

    <h3>Audio Settings</h3>
    <div class="toggle-row"><span>Sound effects</span><div class="toggle ${AppState.sfxOn?'on':''}" id="tg-sfx"><div class="knob"></div></div></div>
    <div class="toggle-row"><span>Music / ambience (rain)</span><div class="toggle ${AppState.musicOn?'on':''}" id="tg-music"><div class="knob"></div></div></div>
    <div class="toggle-row" style="border-bottom:none;flex-direction:column;align-items:stretch;gap:6px;">
      <span>Volume</span>
      <input type="range" id="volume-slider" min="0" max="100" value="${Math.round((AppState.volume??0.5)*100)}" style="width:100%;">
    </div>

    <h3>Preferences</h3>
    <div class="toggle-row"><span>Notifications</span><div class="toggle ${AppState.notifications?'on':''}" id="tg-notif"><div class="knob"></div></div></div>
    <div class="toggle-row"><span>Show mobile controller</span><div class="toggle ${AppState.controlsEnabled!==false?'on':''}" id="tg-controller"><div class="knob"></div></div></div>
    <div class="toggle-row" style="border-bottom:none;"><span>Dark mode (night city)</span><div class="toggle ${night?'on':''}" id="tg-dark"><div class="knob"></div></div></div>

    <h3>About S2 Talk</h3>
    <p>S2 Talk is a virtual city where you practice interviews, build skills, code, track progress, chat with friends, and play — all in one place.</p>
    <p class="sub">Controls: <b>WASD/Arrows</b> move · <b>ENTER</b> enter a building · <b>C</b> toggle car mode · <b>H</b> horn (in car) · <b>R</b> toggle rain · <b>1-9</b> fast travel to a building.</p>
  `;
}
let editProfilePendingRemove = false;
function openEditProfile(){
  const u = AppState.current;
  editProfilePendingRemove = false;
  const picHtml = renderAvatarHtml(u);
  openModal(`
    <h2>✏️ Edit Profile</h2>
    <div class="profile-card" style="margin-bottom:14px;">
      <div class="profile-card-photo" id="ep-photo-preview">${picHtml}</div>
      <div class="profile-card-info" style="justify-content:center;">
        <label class="btn btn-outline btn-sm" style="cursor:pointer;display:inline-block;width:fit-content;">Upload Photo<input type="file" id="ep-photo-input" accept="image/*" style="display:none;"></label>
        <button class="btn btn-ghost btn-sm" id="ep-remove-photo" style="width:fit-content;">Remove Photo</button>
      </div>
    </div>
    <div class="field"><label>Full Name</label><input class="inp" id="ep-name" value="${escapeHtml(u.name)}"></div>
    <div class="field"><label>Bio / About Me</label><textarea class="ta" id="ep-bio" rows="3">${escapeHtml(u.bio||'')}</textarea></div>
    <div class="field"><label>Skills</label><input class="inp" id="ep-skills" value="${escapeHtml(u.skills||'')}" placeholder="e.g. Python, React, UI Design"></div>
    <div class="field"><label>Interests</label><input class="inp" id="ep-interests" value="${escapeHtml(u.interests||'')}" placeholder="e.g. Chess, Hiking, Reading"></div>
    <div class="field"><label>City</label><input class="inp" id="ep-city" value="${escapeHtml(u.city||'')}" placeholder="e.g. Bengaluru"></div>
    <div class="err" id="ep-err"></div>
    <div class="btn-row" style="margin-top:12px;">
      <button class="btn btn-primary btn-sm" id="ep-save">Save Changes</button>
      <button class="btn btn-ghost btn-sm" id="ep-cancel">Cancel</button>
    </div>
  `);
  const photoInput=document.getElementById('ep-photo-input');
  photoInput.addEventListener('change', ()=>{
    const f=photoInput.files[0]; if(!f) return;
    editProfilePendingRemove=false;
    const reader=new FileReader();
    reader.onload=ev=>{ document.getElementById('ep-photo-preview').innerHTML = `<img src="${ev.target.result}">`; };
    reader.readAsDataURL(f);
  });
  document.getElementById('ep-remove-photo').addEventListener('click', ()=>{
    editProfilePendingRemove=true;
    photoInput.value='';
    document.getElementById('ep-photo-preview').innerHTML = AppState.avatarEmoji || '🙂';
  });
  document.getElementById('ep-cancel').addEventListener('click', ()=>{ openModal(renderSettings()); });
  document.getElementById('ep-save').addEventListener('click', async ()=>{
    const saveBtn=document.getElementById('ep-save');
    const name = document.getElementById('ep-name').value.trim();
    if(!name){ document.getElementById('ep-err').textContent='Name cannot be empty.'; document.getElementById('ep-err').style.display='block'; return; }
    saveBtn.disabled=true; saveBtn.textContent='Saving...';
    const fd=new FormData();
    fd.append('name', name);
    fd.append('bio', document.getElementById('ep-bio').value);
    fd.append('skills', document.getElementById('ep-skills').value);
    fd.append('interests', document.getElementById('ep-interests').value);
    fd.append('city', document.getElementById('ep-city').value);
    if(editProfilePendingRemove) fd.append('remove_avatar', '1');
    else if(photoInput.files[0]) fd.append('avatar', photoInput.files[0]);
    try{
      const res=await fetch('/api/update-profile', {method:'POST', body:fd});
      const data=await res.json();
      if(res.ok){
        applyProfileUpdateEverywhere(data.user);
        toast('✅ Profile updated');
        openModal(renderSettings());
      } else {
        document.getElementById('ep-err').textContent = data.error||'Could not save profile.';
        document.getElementById('ep-err').style.display='block';
        saveBtn.disabled=false; saveBtn.textContent='Save Changes';
      }
    }catch(e){
      document.getElementById('ep-err').textContent='Network error — is the server running?';
      document.getElementById('ep-err').style.display='block';
      saveBtn.disabled=false; saveBtn.textContent='Save Changes';
    }
  });
}
function applyProfileUpdateEverywhere(freshUser){
  AppState.current = freshUser;
  if(freshUser.avatarEmoji) AppState.avatarEmoji = freshUser.avatarEmoji;
  if(freshUser.carColor) AppState.carColor = freshUser.carColor;
  paintProfileChips(freshUser);
}
function wireSettings(){
  document.querySelectorAll('[data-avatar]').forEach(el=>el.addEventListener('click', async ()=>{
    AppState.avatarEmoji=el.dataset.avatar; paintProfileChips(AppState.current); openModal(renderSettings()); toast('Avatar updated');
    try{
      const fd=new FormData(); fd.append('avatar_emoji', el.dataset.avatar);
      const res=await fetch('/api/update-profile', {method:'POST', body:fd});
      if(res.ok){ const data=await res.json(); applyProfileUpdateEverywhere(data.user); }
    }catch(e){ /* offline — local UI already updated, will resync next successful save */ }
  }));
  document.querySelectorAll('[data-color]').forEach(el=>el.addEventListener('click', async ()=>{
    AppState.carColor=el.dataset.color; openModal(renderSettings()); toast('Car color updated');
    try{
      const fd=new FormData(); fd.append('car_color', el.dataset.color);
      const res=await fetch('/api/update-profile', {method:'POST', body:fd});
      if(res.ok){ const data=await res.json(); applyProfileUpdateEverywhere(data.user); }
    }catch(e){ /* offline — local UI already updated, will resync next successful save */ }
  }));

  const tgN=document.getElementById('tg-notif');
  if(tgN) tgN.addEventListener('click', ()=>{ AppState.notifications=!AppState.notifications; saveUserData(); tgN.classList.toggle('on'); toast(AppState.notifications?'🔔 Notifications on':'🔕 Notifications off'); });
  const tgCtrl=document.getElementById('tg-controller');
  if(tgCtrl) tgCtrl.addEventListener('click', ()=>{
    AppState.controlsEnabled = AppState.controlsEnabled===false ? true : false;
    saveUserData();
    tgCtrl.classList.toggle('on');
    if(typeof window.applyControllerEnabledState==='function') window.applyControllerEnabledState();
    toast(AppState.controlsEnabled!==false ? '🕹️ Mobile controller shown' : '🕹️ Mobile controller hidden');
  });
  const tgD=document.getElementById('tg-dark');
  if(tgD) tgD.addEventListener('click', ()=>{ document.getElementById('daynight-btn').click(); tgD.classList.toggle('on'); });
  const tgS=document.getElementById('tg-sfx');
  if(tgS) tgS.addEventListener('click', ()=>{ AppState.sfxOn=!AppState.sfxOn; Audio_.setSfx(AppState.sfxOn); saveAudioPrefs(); tgS.classList.toggle('on'); toast(AppState.sfxOn?'🔊 Sound effects on':'🔇 Sound effects off'); const muteBtn=document.getElementById('mute-btn'); if(muteBtn) muteBtn.textContent = AppState.sfxOn ? '🔊' : '🔇'; });
  const tgM=document.getElementById('tg-music');
  if(tgM) tgM.addEventListener('click', ()=>{ AppState.musicOn=!AppState.musicOn; Audio_.setMusic(AppState.musicOn); saveAudioPrefs(); tgM.classList.toggle('on'); toast(AppState.musicOn?'🎵 Music/ambience on':'🔕 Music/ambience off'); });
  const vol=document.getElementById('volume-slider');
  if(vol) vol.addEventListener('input', ()=>{ AppState.volume=parseInt(vol.value)/100; Audio_.setVolume(AppState.volume); saveAudioPrefs(); });

  const editBtn=document.getElementById('open-edit-profile');
  if(editBtn) editBtn.addEventListener('click', openEditProfile);

  const cp=document.getElementById('acct-change-pass');
  if(cp) cp.addEventListener('click', ()=>{
    openModal(`
      <h2>Change Password</h2>
      <div class="field"><label>Current password</label><input type="password" class="inp" id="cp-old"></div>
      <div class="field"><label>New password (min 6 chars)</label><input type="password" class="inp" id="cp-new"></div>
      <div class="err" id="cp-err"></div>
      <button class="btn btn-primary" id="cp-submit" style="width:100%;">Update Password</button>
    `);
    document.getElementById('cp-submit').addEventListener('click', async ()=>{
      const old_password=document.getElementById('cp-old').value;
      const new_password=document.getElementById('cp-new').value;
      const errEl=document.getElementById('cp-err');
      try{
        const res=await fetch('/api/change-password', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({old_password, new_password})});
        const data=await res.json();
        if(!res.ok){ errEl.textContent=data.error||'Could not update password.'; errEl.style.display='block'; return; }
        closeModal(); toast('🔑 Password updated');
      }catch(e){ errEl.textContent='Network error — is the server running?'; errEl.style.display='block'; }
    });
  });

  const lo=document.getElementById('acct-logout');
  if(lo) lo.addEventListener('click', async ()=>{
    cleanupInterviewMedia();
    await fetch('/api/logout', {method:'POST'});
    location.reload();
  });

  const del=document.getElementById('acct-delete');
  if(del) del.addEventListener('click', ()=>{
    openModal(`
      <h2>Delete Account</h2>
      <p class="sub">This permanently deletes your account and all associated data. Enter your password to confirm.</p>
      <div class="field"><label>Password</label><input type="password" class="inp" id="del-pass"></div>
      <div class="err" id="del-err"></div>
      <button class="btn btn-sm" style="background:#FF6F5E;color:#fff;width:100%;" id="del-submit">Permanently Delete Account</button>
    `);
    document.getElementById('del-submit').addEventListener('click', async ()=>{
      const password=document.getElementById('del-pass').value;
      const errEl=document.getElementById('del-err');
      try{
        const res=await fetch('/api/delete-account', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password})});
        const data=await res.json();
        if(!res.ok){ errEl.textContent=data.error||'Could not delete account.'; errEl.style.display='block'; return; }
        clearLocalUserData(AppState.current ? AppState.current.uid : null);
        closeModal(); window.showCustomConfirm('Delete Account', 'Permanently delete your account?', 'Account Deleted', () => { location.reload(); });
      }catch(e){ errEl.textContent='Network error — is the server running?'; errEl.style.display='block'; }
    });
  });
}

/* ============================================================
   BUILDING 9 — PLAY HOUSE
   ============================================================ */
let ttt=Array(9).fill(null); let tttOver=false;
function renderPlay(){
  return `
    <h2>🎮 Play House</h2>
    <div class="row" style="align-items:center;justify-content:space-between;margin-top:12px;">
      <h3 style="margin:0;">Tic-Tac-Toe vs AI</h3>
      <button class="btn btn-primary btn-sm" id="ttt-start-btn">🎮 Play Game (10 🪙)</button>
    </div>
    <div class="ttt-grid" id="ttt-grid">${ttt.map((v,i)=>`<div class="ttt-cell" data-cell="${i}">${v||''}</div>`).join('')}</div>
    <button class="btn btn-ghost btn-sm" id="ttt-reset" style="margin-top:6px;">Reset</button>

    <div class="row" style="align-items:center;justify-content:space-between;margin-top:18px;">
      <h3 style="margin:0;">Memory Match</h3>
      <button class="btn btn-primary btn-sm" id="mem-start-btn">🎮 Play Game (10 🪙)</button>
    </div>
    <div id="mem-wrap"></div>
    <button class="btn btn-ghost btn-sm" id="mem-reset" style="margin-top:6px;">Shuffle / New Game</button>

    <div class="row" style="align-items:center;justify-content:space-between;margin-top:18px;">
      <h3 style="margin:0;">Rock Paper Scissors</h3>
      <button class="btn btn-primary btn-sm" id="rps-start-btn">🎮 Play Game (10 🪙)</button>
    </div>
    <div id="rps-wrap">${renderRPS()}</div>

    <div class="row" style="align-items:center;justify-content:space-between;margin-top:18px;">
      <h3 style="margin:0;">Typing Speed Test</h3>
      <button class="btn btn-primary btn-sm" id="typing-start-btn">🎮 Play Game (10 🪙)</button>
    </div>
    <div id="typing-wrap">${renderTyping()}</div>

    <div class="row" style="align-items:center;justify-content:space-between;margin-top:18px;">
      <h3 style="margin:0;">Connect Four</h3>
      <button class="btn btn-primary btn-sm" id="c4-start-btn">🎮 Play Game (10 🪙)</button>
    </div>
    <div id="c4-wrap"></div>
    <button class="btn btn-ghost btn-sm" id="c4-reset" style="margin-top:6px;">New Game</button>

    <div class="row" style="align-items:center;justify-content:space-between;margin-top:18px;">
      <h3 style="margin:0;">🐍 Snake Arcade</h3>
      <button class="btn btn-primary btn-sm" id="snake-start-btn">🎮 Play Game (10 🪙)</button>
    </div>
    <div class="item-card"><div class="row" style="align-items:center;justify-content:space-between;"><span>Retro grid snake game with score rewards.</span><button class="btn btn-outline btn-sm" id="snake-play-direct">▶ Launch (10 🪙)</button></div></div>

    <div class="row" style="align-items:center;justify-content:space-between;margin-top:18px;">
      <h3 style="margin:0;">🏓 Pong Match</h3>
      <button class="btn btn-primary btn-sm" id="pong-start-btn">🎮 Play Game (10 🪙)</button>
    </div>
    <div class="item-card"><div class="row" style="align-items:center;justify-content:space-between;"><span>Arcade table tennis vs AI opponent.</span><button class="btn btn-outline btn-sm" id="pong-play-direct">▶ Launch (10 🪙)</button></div></div>

    <div class="row" style="align-items:center;justify-content:space-between;margin-top:18px;">
      <h3 style="margin:0;">🔢 Math Speed Challenge</h3>
      <button class="btn btn-primary btn-sm" id="math-start-btn">🎮 Play Game (10 🪙)</button>
    </div>
    <div class="item-card"><div class="row" style="align-items:center;justify-content:space-between;"><span>25-second rapid mental arithmetic test.</span><button class="btn btn-outline btn-sm" id="math-play-direct">▶ Launch (10 🪙)</button></div></div>

    <div class="row" style="align-items:center;justify-content:space-between;margin-top:18px;">
      <h3 style="margin:0;">🎯 Reaction Speed Test</h3>
      <button class="btn btn-primary btn-sm" id="reaction-start-btn">🎮 Play Game (10 🪙)</button>
    </div>
    <div class="item-card"><div class="row" style="align-items:center;justify-content:space-between;"><span>Test your reflex speed in milliseconds.</span><button class="btn btn-outline btn-sm" id="reaction-play-direct">▶ Launch (10 🪙)</button></div></div>
  `;
}

let snakeGameTimer = null;
function renderSnakeGameModal(){
  openModal(`
    <h2>🐍 Snake Arcade</h2>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <div class="sub">Score: <b id="snake-score">0</b></div>
    </div>
    <div style="text-align:center;">
      <canvas id="snake-canvas" width="280" height="280" style="background:#0d1117;border:2px solid var(--border);border-radius:10px;"></canvas>
    </div>
    <div class="pill-row" style="justify-content:center;margin-top:10px;gap:6px;">
      <button class="btn btn-outline btn-sm" id="snake-btn-up">⬆️</button>
    </div>
    <div class="pill-row" style="justify-content:center;gap:6px;">
      <button class="btn btn-outline btn-sm" id="snake-btn-left">⬅️</button>
      <button class="btn btn-outline btn-sm" id="snake-btn-down">⬇️</button>
      <button class="btn btn-outline btn-sm" id="snake-btn-right">➡️</button>
    </div>
    <div class="btn-row" style="margin-top:12px;gap:8px;">
      <button class="btn btn-primary btn-sm" id="snake-restart-btn">🔄 Restart Game</button>
      <button class="btn btn-ghost btn-sm" id="snake-back-btn">← Back to Play House</button>
    </div>
  `);

  const canvas = document.getElementById('snake-canvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const grid = 14;
  let snake = [{x: 10, y: 10}, {x: 9, y: 10}, {x: 8, y: 10}];
  let dx = 1, dy = 0;
  let food = {x: 15, y: 15};
  let score = 0;
  let gameOver = false;

  function placeFood(){
    food = {
      x: Math.floor(Math.random() * (canvas.width / grid)),
      y: Math.floor(Math.random() * (canvas.height / grid))
    };
  }

  clearInterval(snakeGameTimer);
  snakeGameTimer = setInterval(() => {
    if(gameOver) return;
    const head = {x: snake[0].x + dx, y: snake[0].y + dy};

    if(head.x < 0 || head.x >= canvas.width / grid || head.y < 0 || head.y >= canvas.height / grid || snake.some(s => s.x === head.x && s.y === head.y)){
      gameOver = true;
      clearInterval(snakeGameTimer);
      ctx.fillStyle = 'rgba(255, 111, 94, 0.85)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('GAME OVER!', canvas.width / 2, canvas.height / 2 - 10);
      ctx.font = '14px sans-serif';
      ctx.fillText(`Final Score: ${score}`, canvas.width / 2, canvas.height / 2 + 16);

      const earnedCoins = Math.floor(score / 5);
      if(earnedCoins > 0) addCoins(earnedCoins, 'game');
      addXP(score);
      submitScore('game', score, `Snake Score: ${score}`);
      recordMatch('Snake Game', score > 0 ? 'Completed' : 'Loss');
      unlockAchievement('gamer');
      return;
    }

    snake.unshift(head);
    if(head.x === food.x && head.y === food.y){
      score += 10;
      const scoreEl = document.getElementById('snake-score');
      if(scoreEl) scoreEl.textContent = score;
      Audio_.notification();
      placeFood();
    } else {
      snake.pop();
    }

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#FF6F5E';
    ctx.beginPath();
    ctx.arc(food.x * grid + grid/2, food.y * grid + grid/2, grid/2 - 1, 0, Math.PI * 2);
    ctx.fill();

    snake.forEach((s, idx) => {
      ctx.fillStyle = idx === 0 ? '#58a6ff' : '#238636';
      ctx.fillRect(s.x * grid + 1, s.y * grid + 1, grid - 2, grid - 2);
    });
  }, 190);

  const keyHandler = (e) => {
    if(e.key === 'ArrowUp' && dy === 0){ dx = 0; dy = -1; }
    else if(e.key === 'ArrowDown' && dy === 0){ dx = 0; dy = 1; }
    else if(e.key === 'ArrowLeft' && dx === 0){ dx = -1; dy = 0; }
    else if(e.key === 'ArrowRight' && dx === 0){ dx = 1; dy = 0; }
  };
  window.addEventListener('keydown', keyHandler);

  document.getElementById('snake-btn-up')?.addEventListener('click', ()=>{ if(dy===0){ dx=0; dy=-1; } });
  document.getElementById('snake-btn-down')?.addEventListener('click', ()=>{ if(dy===0){ dx=0; dy=1; } });
  document.getElementById('snake-btn-left')?.addEventListener('click', ()=>{ if(dx===0){ dx=-1; dy=0; } });
  document.getElementById('snake-btn-right')?.addEventListener('click', ()=>{ if(dx===0){ dx=1; dy=0; } });
  document.getElementById('snake-restart-btn')?.addEventListener('click', ()=>{ window.removeEventListener('keydown', keyHandler); renderSnakeGameModal(); });
  document.getElementById('snake-back-btn')?.addEventListener('click', ()=>{ clearInterval(snakeGameTimer); window.removeEventListener('keydown', keyHandler); openModal(renderPlay()); });
}

let pongGameTimer = null;
function renderPongGameModal(){
  openModal(`
    <h2>🏓 Pong Arcade</h2>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <div class="sub">Player: <b id="pong-player-score">0</b></div>
      <div class="sub">AI: <b id="pong-ai-score">0</b></div>
    </div>
    <div style="text-align:center;">
      <canvas id="pong-canvas" width="320" height="200" style="background:#0d1117;border:2px solid var(--border);border-radius:10px;"></canvas>
    </div>
    <div class="pill-row" style="justify-content:center;margin-top:10px;gap:6px;">
      <button class="btn btn-outline btn-sm" id="pong-btn-up">⬆️ Move Up</button>
      <button class="btn btn-outline btn-sm" id="pong-btn-down">⬇️ Move Down</button>
    </div>
    <div class="btn-row" style="margin-top:12px;gap:8px;">
      <button class="btn btn-primary btn-sm" id="pong-restart-btn">🔄 Restart Match</button>
      <button class="btn btn-ghost btn-sm" id="pong-back-btn">← Back to Play House</button>
    </div>
  `);

  const canvas = document.getElementById('pong-canvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');

  let playerY = 75, aiY = 75;
  const paddleHeight = 50, paddleWidth = 8;
  let ballX = 160, ballY = 100, ballSpeedX = 4.5, ballSpeedY = 3.2;
  let playerScore = 0, aiScore = 0;
  let gameOver = false;

  clearInterval(pongGameTimer);
  pongGameTimer = setInterval(() => {
    if(gameOver) return;

    ballX += ballSpeedX;
    ballY += ballSpeedY;

    if(aiY + paddleHeight/2 < ballY - 10) aiY += 3.5;
    else if(aiY + paddleHeight/2 > ballY + 10) aiY -= 3.5;

    if(ballY <= 0 || ballY >= canvas.height) ballSpeedY = -ballSpeedY;

    if(ballX <= paddleWidth && ballY >= playerY && ballY <= playerY + paddleHeight){
      ballSpeedX = -ballSpeedX;
      Audio_.notification();
    }
    if(ballX >= canvas.width - paddleWidth && ballY >= aiY && ballY <= aiY + paddleHeight){
      ballSpeedX = -ballSpeedX;
    }

    if(ballX < 0){
      aiScore++;
      const sEl = document.getElementById('pong-ai-score');
      if(sEl) sEl.textContent = aiScore;
      ballX = 160; ballY = 100; ballSpeedX = 4.5;
    } else if(ballX > canvas.width){
      playerScore++;
      const sEl = document.getElementById('pong-player-score');
      if(sEl) sEl.textContent = playerScore;
      ballX = 160; ballY = 100; ballSpeedX = -4.5;
    }

    if(playerScore >= 3 || aiScore >= 3){
      gameOver = true;
      clearInterval(pongGameTimer);
      const won = playerScore >= 3;
      ctx.fillStyle = won ? 'rgba(35, 134, 54, 0.9)' : 'rgba(255, 111, 94, 0.9)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(won ? 'YOU WIN!' : 'AI WINS!', canvas.width / 2, canvas.height / 2);

      if(won){
        addCoins(15, 'game');
        addXP(20);
        submitScore('game', 100, 'Pong Win');
        recordMatch('Pong', 'Win');
      } else {
        addCoins(3, 'game');
        recordMatch('Pong', 'Loss');
      }
      return;
    }

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#58a6ff';
    ctx.fillRect(4, playerY, paddleWidth, paddleHeight);

    ctx.fillStyle = '#ff7b72';
    ctx.fillRect(canvas.width - paddleWidth - 4, aiY, paddleWidth, paddleHeight);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ballX, ballY, 5, 0, Math.PI * 2);
    ctx.fill();
  }, 1000/60);

  const moveHandler = (e) => {
    if(e.key === 'ArrowUp') playerY = Math.max(0, playerY - 20);
    if(e.key === 'ArrowDown') playerY = Math.min(canvas.height - paddleHeight, playerY + 20);
  };
  window.addEventListener('keydown', moveHandler);

  document.getElementById('pong-btn-up')?.addEventListener('click', ()=>{ playerY = Math.max(0, playerY - 20); });
  document.getElementById('pong-btn-down')?.addEventListener('click', ()=>{ playerY = Math.min(canvas.height - paddleHeight, playerY + 20); });
  document.getElementById('pong-restart-btn')?.addEventListener('click', ()=>{ window.removeEventListener('keydown', moveHandler); renderPongGameModal(); });
  document.getElementById('pong-back-btn')?.addEventListener('click', ()=>{ clearInterval(pongGameTimer); window.removeEventListener('keydown', moveHandler); openModal(renderPlay()); });
}

let mathTimer = null;
function renderMathChallengeModal(){
  let score = 0;
  let timeLeft = 25;
  let currentAns = 0;

  function nextQuestion(){
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    const ops = ['+', '-', '*'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    let ans = 0;
    if(op==='+') ans = a + b;
    else if(op==='-') ans = a - b;
    else ans = a * b;

    currentAns = ans;
    const qEl = document.getElementById('math-q');
    if(qEl) qEl.textContent = `${a} ${op} ${b} = ?`;

    const choices = [ans, ans + Math.floor(Math.random()*5)+1, ans - Math.floor(Math.random()*5)-1, ans + Math.floor(Math.random()*10)+2].sort(()=>Math.random()-0.5);
    const wrap = document.getElementById('math-choices');
    if(wrap){
      wrap.innerHTML = choices.map(c => `<button class="btn btn-outline btn-sm math-ans-btn" data-val="${c}" style="font-size:16px;padding:8px 16px;">${c}</button>`).join('');
      document.querySelectorAll('.math-ans-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const val = parseInt(btn.dataset.val);
          if(val === currentAns){
            score += 10;
            toast('✅ Correct! +10 pts');
            Audio_.notification();
          } else {
            score = Math.max(0, score - 5);
            toast('❌ Wrong! -5 pts');
          }
          const sEl = document.getElementById('math-score-echo');
          if(sEl) sEl.textContent = score;
          nextQuestion();
        });
      });
    }
  }

  openModal(`
    <h2>🔢 Math Speed Challenge</h2>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div class="sub">Time: <b id="math-time">25</b>s</div>
      <div class="sub">Score: <b id="math-score-echo">0</b></div>
    </div>
    <div style="text-align:center;padding:16px;background:var(--bg1);border:1px solid var(--border);border-radius:12px;">
      <h2 id="math-q" style="font-size:28px;color:var(--brand,#5B4FE8);margin-bottom:14px;">Loading...</h2>
      <div id="math-choices" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;"></div>
    </div>
    <div class="btn-row" style="margin-top:16px;gap:8px;">
      <button class="btn btn-primary btn-sm" id="math-restart-btn">🔄 Challenge Again</button>
      <button class="btn btn-ghost btn-sm" id="math-back-btn">← Back to Play House</button>
    </div>
  `);

  nextQuestion();
  clearInterval(mathTimer);
  mathTimer = setInterval(() => {
    timeLeft--;
    const tEl = document.getElementById('math-time');
    if(tEl) tEl.textContent = timeLeft;

    if(timeLeft <= 0){
      clearInterval(mathTimer);
      const earnedCoins = Math.floor(score / 5);
      if(earnedCoins > 0) addCoins(earnedCoins, 'game');
      addXP(score);
      submitScore('game', score, `Math Score: ${score}`);
      recordMatch('Math Challenge', score > 0 ? 'Completed' : 'Loss');

      openModal(`
        <h2>🎉 Time Up!</h2>
        <div class="stat-box" style="max-width:160px;margin:12px auto;"><div class="n">${score}</div><div class="l">Final Score</div></div>
        <p class="sub" style="text-align:center;">You earned 🪙<b>${earnedCoins}</b> coins and <b>${score}</b> XP!</p>
        <div class="btn-row" style="margin-top:16px;gap:8px;">
          <button class="btn btn-primary btn-sm" id="math-modal-restart">🔄 Challenge Again</button>
          <button class="btn btn-ghost btn-sm" id="math-modal-back">← Back to Play House</button>
        </div>
      `);
      document.getElementById('math-modal-restart')?.addEventListener('click', renderMathChallengeModal);
      document.getElementById('math-modal-back')?.addEventListener('click', ()=>{ openModal(renderPlay()); });
    }
  }, 1000);

  document.getElementById('math-restart-btn')?.addEventListener('click', renderMathChallengeModal);
  document.getElementById('math-back-btn')?.addEventListener('click', ()=>{ clearInterval(mathTimer); openModal(renderPlay()); });
}

function renderReactionTestModal(){
  openModal(`
    <h2>🎯 Reaction Speed Test</h2>
    <p class="sub">Click when the box turns GREEN as fast as you can!</p>
    <div id="reaction-box" style="height:140px;background:#FF6F5E;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;font-weight:bold;cursor:pointer;margin:14px 0;box-shadow:0 4px 12px rgba(0,0,0,0.2);">
      WAIT FOR GREEN...
    </div>
    <div id="reaction-result" style="text-align:center;margin-bottom:12px;display:none;">
      <h3 id="reaction-time-echo" style="margin:0;color:var(--brand,#5B4FE8);">0 ms</h3>
      <p id="reaction-grade-echo" class="sub" style="font-weight:bold;"></p>
    </div>
    <div class="btn-row" style="gap:8px;">
      <button class="btn btn-primary btn-sm" id="reaction-restart-btn">🎯 Test Again</button>
      <button class="btn btn-ghost btn-sm" id="reaction-back-btn">← Back to Play House</button>
    </div>
  `);

  const box = document.getElementById('reaction-box');
  if(!box) return;
  let startTime = 0;
  let state = 'waiting';
  const delay = Math.floor(Math.random() * 2500) + 1500;

  const timeoutId = setTimeout(() => {
    if(state === 'waiting'){
      state = 'ready';
      box.style.background = '#238636';
      box.textContent = '⚡ CLICK NOW!';
      startTime = Date.now();
    }
  }, delay);

  box.addEventListener('click', () => {
    if(state === 'waiting'){
      clearTimeout(timeoutId);
      box.style.background = '#d73a49';
      box.textContent = '❌ Too early! Click restart.';
    } else if(state === 'ready'){
      state = 'done';
      const ms = Date.now() - startTime;
      box.style.background = '#58a6ff';
      box.textContent = `🎯 ${ms} ms!`;

      let grade = '👍 Good Reflexes!';
      let coins = 5;
      if(ms < 220){ grade = '⚡ Lightning Fast!'; coins = 20; }
      else if(ms < 320){ grade = '🚀 Great Reflexes!'; coins = 10; }

      const timeEcho = document.getElementById('reaction-time-echo');
      const gradeEcho = document.getElementById('reaction-grade-echo');
      const resBox = document.getElementById('reaction-result');
      if(timeEcho) timeEcho.textContent = `${ms} ms`;
      if(gradeEcho) gradeEcho.textContent = grade;
      if(resBox) resBox.style.display = 'block';

      addCoins(coins, 'game');
      addXP(15);
      submitScore('game', Math.max(1, 1000 - ms), `Reaction: ${ms}ms`);
      recordMatch('Reaction Test', `${ms}ms`);
      Audio_.notification();
    }
  });

  document.getElementById('reaction-restart-btn')?.addEventListener('click', renderReactionTestModal);
  document.getElementById('reaction-back-btn')?.addEventListener('click', ()=>{ clearTimeout(timeoutId); openModal(renderPlay()); });
}

function tttWinner(b){
  const lines=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for(const [a,b1,c] of lines){ if(b[a] && b[a]===b[b1] && b[a]===b[c]) return b[a]; }
  return b.every(x=>x) ? 'draw' : null;
}

function tttAiMove(){
  const empty=ttt.map((v,i)=>v?null:i).filter(i=>i!==null);
  if(!empty.length) return;
  const pick=empty[Math.floor(Math.random()*empty.length)];
  ttt[pick]='O';
}
let tttStartTime = Date.now();
let tttCharged=false, memCharged=false, rpsCharged=false, typingCharged=false, c4Charged=false, g2048Charged=false;
function wirePlay(){
  const tttStart = document.getElementById('ttt-start-btn');
  if(tttStart) tttStart.addEventListener('click', ()=>{
    gatePlay('Tic-Tac-Toe', 10, ()=>{ ttt=Array(9).fill(null); tttOver=false; tttStartTime=Date.now(); tttCharged=true; openModal(renderPlay()); });
  });

  const memStart = document.getElementById('mem-start-btn');
  if(memStart) memStart.addEventListener('click', ()=>{
    gatePlay('Memory Match', 10, ()=>{ setupMemory(); memCharged=true; openModal(renderPlay()); });
  });

  const rpsStart = document.getElementById('rps-start-btn');
  if(rpsStart) rpsStart.addEventListener('click', ()=>{
    gatePlay('Rock Paper Scissors', 10, ()=>{ rpsCharged=true; toast('🎮 Entry fee paid! Pick Rock, Paper, or Scissors to play.'); openModal(renderPlay()); });
  });

  const typingStart = document.getElementById('typing-start-btn');
  if(typingStart) typingStart.addEventListener('click', ()=>{
    gatePlay('Typing Speed Test', 10, ()=>{ typingCharged=true; toast('🎮 Entry fee paid! Type the sentence below.'); openModal(renderPlay()); });
  });

  const c4Start = document.getElementById('c4-start-btn');
  if(c4Start) c4Start.addEventListener('click', ()=>{
    gatePlay('Connect Four', 10, ()=>{ setupConnectFour(); c4Charged=true; openModal(renderPlay()); });
  });

  const g2048Start = document.getElementById('g2048-start-btn');
  if(g2048Start) g2048Start.addEventListener('click', ()=>{
    gatePlay('2048', 10, ()=>{ setup2048(); g2048Charged=true; openModal(renderPlay()); });
  });

  document.querySelectorAll('[data-cell]').forEach(c=>c.addEventListener('click', ()=>{
    const i=parseInt(c.dataset.cell);
    if(ttt[i]||tttOver) return;
    if(!tttCharged){
      gatePlay('Tic-Tac-Toe', 10, ()=>{ tttCharged=true; openModal(renderPlay()); document.querySelector(`[data-cell="${i}"]`)?.click(); });
      return;
    }
    ttt[i]='X';
    unlockAchievement('gamer'); progressMission('game1',1); addXP(8);
    let w=tttWinner(ttt);
    if(!w){ tttAiMove(); w=tttWinner(ttt); }
    if(w){
      tttOver=true;
      const secs = Math.max(1, Math.round((Date.now()-tttStartTime)/1000));
      const result = w==='draw' ? 'Draw' : (w==='X' ? 'Win' : 'Loss');
      const points = w==='draw' ? 20 : (w==='X' ? 50 : 10);
      const coins = w==='draw' ? 3 : (w==='X' ? 10 : 2);
      addCoins(coins,'game');
      submitScore('game', points, 'Tic-Tac-Toe: '+result);
      recordMatch('Tic-Tac-Toe', result);
      setTimeout(()=>{
        const winnerLabel = w==='draw' ? 'Draw' : (w==='X' ? AppState.current?.name || 'Player' : 'AI');
        const pScore = w==='X' ? 1 : 0; const aScore = w==='O' ? 1 : 0;
        showGameResultModal('Tic-Tac-Toe', winnerLabel, pScore, aScore, coins, ()=>{
          ttt=Array(9).fill(null); tttOver=false; tttStartTime=Date.now(); openModal(renderPlay());
        });
      }, 50);
      return;
    }
    openModal(renderPlay());
  }));
  const rst=document.getElementById('ttt-reset');
  if(rst) rst.addEventListener('click', ()=>{
    gatePlay('Tic-Tac-Toe', 10, ()=>{ ttt=Array(9).fill(null); tttOver=false; tttStartTime=Date.now(); tttCharged=true; openModal(renderPlay()); });
  });
  setupMemory();
  const mrst=document.getElementById('mem-reset');
  if(mrst) mrst.addEventListener('click', ()=>{ gatePlay('Memory Match', 10, ()=>{ setupMemory(); memCharged=true; openModal(renderPlay()); }); });
  wireRPS();
  wireTyping();
  setupConnectFour();
  const c4rst=document.getElementById('c4-reset');
  if(c4rst) c4rst.addEventListener('click', ()=>{ gatePlay('Connect Four', 10, ()=>{ setupConnectFour(); c4Charged=true; openModal(renderPlay()); }); });
  setup2048();
  const g2048rst=document.getElementById('g2048-reset');
  if(g2048rst) g2048rst.addEventListener('click', ()=>{ gatePlay('2048', 10, ()=>{ setup2048(); g2048Charged=true; openModal(renderPlay()); }); });

  const snakeStart = document.getElementById('snake-start-btn');
  if(snakeStart) snakeStart.addEventListener('click', ()=>{ gatePlay('Snake Arcade', 10, renderSnakeGameModal); });
  const snakeDirect = document.getElementById('snake-play-direct');
  if(snakeDirect) snakeDirect.addEventListener('click', ()=>{ gatePlay('Snake Arcade', 10, renderSnakeGameModal); });

  const pongStart = document.getElementById('pong-start-btn');
  if(pongStart) pongStart.addEventListener('click', ()=>{ gatePlay('Pong Match', 10, renderPongGameModal); });
  const pongDirect = document.getElementById('pong-play-direct');
  if(pongDirect) pongDirect.addEventListener('click', ()=>{ gatePlay('Pong Match', 10, renderPongGameModal); });

  const mathStart = document.getElementById('math-start-btn');
  if(mathStart) mathStart.addEventListener('click', ()=>{ gatePlay('Math Speed Challenge', 10, renderMathChallengeModal); });
  const mathDirect = document.getElementById('math-play-direct');
  if(mathDirect) mathDirect.addEventListener('click', ()=>{ gatePlay('Math Speed Challenge', 10, renderMathChallengeModal); });

  const reactionStart = document.getElementById('reaction-start-btn');
  if(reactionStart) reactionStart.addEventListener('click', ()=>{ gatePlay('Reaction Speed Test', 10, renderReactionTestModal); });
  const reactionDirect = document.getElementById('reaction-play-direct');
  if(reactionDirect) reactionDirect.addEventListener('click', ()=>{ gatePlay('Reaction Speed Test', 10, renderReactionTestModal); });
}

function showGameResultModal(gameLabel, winnerLabel, playerScore, aiScore, coinsEarned, onPlayAgain){
  openModal(`
    <h2>🏆 Game Results</h2>
    <div class="item-card" style="text-align:center;padding:16px;">
      <p class="sub">Game: <b>${escapeHtml(gameLabel)}</b></p>
      <h3 style="margin-bottom:6px;">Winner: ${escapeHtml(winnerLabel)}</h3>
      <div class="sub" style="font-size:16px;margin-bottom:8px;">Score: <b>${playerScore} - ${aiScore}</b></div>
      <div style="font-size:20px;font-weight:700;color:var(--brand,#5B4FE8);margin:12px 0;">Coins Earned: +${coinsEarned} 🪙</div>
      <div class="btn-row" style="justify-content:center;gap:12px;margin-top:14px;">
        <button class="btn btn-primary btn-sm" id="game-res-again">Play Again</button>
        <button class="btn btn-ghost btn-sm" id="game-res-exit">Exit</button>
      </div>
    </div>
  `);
  document.getElementById('game-res-again').addEventListener('click', ()=>{
    gatePlay(gameLabel, 10, onPlayAgain);
  });
  document.getElementById('game-res-exit').addEventListener('click', ()=>{
    openModal(renderPlay());
  });
}

function gameSummaryHtml(game, result, secs, points, coins){
  return `<div class="item-card" style="border-left:4px solid var(--brand,#5B4FE8);margin-bottom:12px;">
    <b>🏁 ${game} — ${result}</b>
    <div class="grid2" style="margin-top:8px;">
      <div class="stat-box"><div class="n">${points}</div><div class="l">Score</div></div>
      <div class="stat-box"><div class="n">${secs}s</div><div class="l">Time Taken</div></div>
      <div class="stat-box"><div class="n">🪙${coins}</div><div class="l">Reward</div></div>
      <div class="stat-box"><div class="n">+8</div><div class="l">XP Earned</div></div>
    </div>
  </div>`;
}
function recordMatch(game, result){
  AppState.matchHistory = AppState.matchHistory || [];
  AppState.matchHistory.unshift({game, result, date: new Date().toLocaleDateString(), winner: result==='Win'? AppState.current.name : (result==='Loss'?'AI':'—')});
  if(AppState.matchHistory.length>20) AppState.matchHistory.length=20;
}
function addCoins(n, source){
  if(!n) return;
  AppState.coins=(AppState.coins||0)+n;
  AppState.coinsEarned=(AppState.coinsEarned||0)+n;
  AppState.coinsBySource = AppState.coinsBySource || {level:0, game:0, mission:0, other:0};
  const key = (source && AppState.coinsBySource[source]!==undefined) ? source : 'other';
  AppState.coinsBySource[key] += n;
  saveUserData();
}
function trySpendCoins(n){
  if((AppState.coins||0) < n) return false;
  AppState.coins -= n;
  AppState.coinsSpent = (AppState.coinsSpent||0) + n;
  const badge = document.getElementById('xp-badge');
  if(badge) badge.textContent = `⭐ Lv.${AppState.level} · ${AppState.xp} XP · 🪙${AppState.coins}`;
  saveUserData();
  return true;
}
function gatePlay(gameLabel, cost, onConfirm){
  if((AppState.coins||0) < cost){
    openModal(`<h2>🎮 Game Entry Fee</h2><p class="sub">Game: <b>${escapeHtml(gameLabel)}</b></p><h3>Cost: 🪙 ${cost} Coins</h3>
      <p style="color:var(--coral);font-weight:700;margin-top:8px;">Not enough coins.</p>
      <p class="sub">Current balance: 🪙${AppState.coins||0}.</p>
      <button class="btn btn-ghost btn-sm" id="gate-back" style="margin-top:12px;">← Back to Play House</button>`);
    document.getElementById('gate-back').addEventListener('click', ()=>{ openModal(renderPlay()); });
    return;
  }
  openModal(`<h2>🎮 Game Entry Fee</h2><p class="sub">Game: <b>${escapeHtml(gameLabel)}</b></p><h3>Cost: 🪙 ${cost} Coins</h3>
    <div class="btn-row" style="margin-top:14px;gap:8px;">
      <button class="btn btn-primary btn-sm" id="gate-play">Pay &amp; Start</button>
      <button class="btn btn-ghost btn-sm" id="gate-cancel">Cancel</button>
    </div>`);
  document.getElementById('gate-play').addEventListener('click', ()=>{
    trySpendCoins(cost);
    onConfirm();
  });
  document.getElementById('gate-cancel').addEventListener('click', ()=>{ openModal(renderPlay()); });
}
let memState=null;
let memStartTime = Date.now();
function setupMemory(){
  const icons=['🍎','🚀','🎵','⭐','🐢','🌵','🎈','🍩'];
  const deck=[...icons,...icons].sort(()=>Math.random()-0.5);
  memState={deck, flipped:[], matched:new Set(), busy:false};
  memStartTime = Date.now();
  renderMemory();
}
function renderMemory(){
  const wrap=document.getElementById('mem-wrap');
  if(!wrap) return;
  wrap.innerHTML = `<div class="mem-grid">${memState.deck.map((ic,i)=>{
    const show = memState.flipped.includes(i) || memState.matched.has(i);
    return `<div class="mem-cell ${show?'flip':''}" data-mem="${i}">${show?ic:'❓'}</div>`;
  }).join('')}</div><p class="sub">Matched ${memState.matched.size/2}/${memState.deck.length/2} pairs</p>`;
  wrap.querySelectorAll('[data-mem]').forEach(c=>c.addEventListener('click', ()=>{
    const i=parseInt(c.dataset.mem);
    if(memState.busy || memState.matched.has(i) || memState.flipped.includes(i)) return;
    if(!memCharged){
      gatePlay('Memory Match', 10, ()=>{ memCharged=true; openModal(renderPlay()); document.querySelector(`[data-mem="${i}"]`)?.click(); });
      return;
    }
    memState.flipped.push(i);
    renderMemory();
    if(memState.flipped.length===2){
      memState.busy=true;
      const [a,b]=memState.flipped;
      if(memState.deck[a]===memState.deck[b]){
        memState.matched.add(a); memState.matched.add(b);
        memState.flipped=[]; memState.busy=false;
        unlockAchievement('gamer'); progressMission('game1',1); addXP(8);
        renderMemory();
        if(memState.matched.size===memState.deck.length){
          const secs = Math.max(1, Math.round((Date.now()-memStartTime)/1000));
          const points = Math.max(10, 100 - secs);
          addCoins(8,'game');
          submitScore('game', points, 'Memory Match');
          recordMatch('Memory Match', 'Win');
          toast('🎉 Memory game complete!');
          if(currentModalView==='play' && overlay.style.display==='flex'){
            openModal(gameSummaryHtml('Memory Match', 'Win', secs, points, 8) + renderPlay());
          }
        }
      } else {
        setTimeout(()=>{ memState.flipped=[]; memState.busy=false; renderMemory(); }, 700);
      }
    }
  }));
}

const RPS_TOTAL_ROUNDS = 10;
let rpsScore={win:0,loss:0,draw:0};
let rpsRound=0;
function renderRPS(){
  const over = rpsRound>=RPS_TOTAL_ROUNDS;
  return `
    <div class="pill-row">
      <button class="btn btn-outline btn-sm" data-rps="rock" ${over?'disabled':''}>✊ Rock</button>
      <button class="btn btn-outline btn-sm" data-rps="paper" ${over?'disabled':''}>✋ Paper</button>
      <button class="btn btn-outline btn-sm" data-rps="scissors" ${over?'disabled':''}>✌️ Scissors</button>
      ${over?'<button class="btn btn-ghost btn-sm" id="rps-new-match">🔁 New Match</button>':''}
    </div>
    <p class="sub" id="rps-result">${over ? 'Match over — start a new match to play again.' : 'Pick one to play against the AI.'}</p>
    <p class="sub">Round ${Math.min(rpsRound, RPS_TOTAL_ROUNDS)}/${RPS_TOTAL_ROUNDS} · Player Wins ${rpsScore.win} · AI Wins ${rpsScore.loss} · Draws ${rpsScore.draw}</p>
    ${over ? `<div class="item-card"><b>🏁 Match Winner: ${rpsScore.win===rpsScore.loss ? "It's a tie!" : (rpsScore.win>rpsScore.loss ? 'Player 🎉' : 'AI 🤖')}</b></div>` : ''}
  `;
}
function wireRPS(){
  document.querySelectorAll('[data-rps]').forEach(b=>b.addEventListener('click', ()=>{
    if(rpsRound>=RPS_TOTAL_ROUNDS) return;
    if(rpsRound===0 && !rpsCharged){
      gatePlay('Rock Paper Scissors', 10, ()=>{ rpsCharged=true; openModal(renderPlay()); document.querySelector(`[data-rps="${b.dataset.rps}"]`)?.click(); });
      return;
    }
    const choices=['rock','paper','scissors'];
    const you=b.dataset.rps;
    const ai=choices[Math.floor(Math.random()*3)];
    const beats={rock:'scissors', paper:'rock', scissors:'paper'};
    let result;
    if(you===ai) result='draw';
    else if(beats[you]===ai) result='win';
    else result='loss';
    rpsScore[result]++;
    rpsRound++;
    const icons={rock:'✊',paper:'✋',scissors:'✌️'};
    if(result==='win'){ addCoins(3,'game'); submitScore('game', 15, 'Rock Paper Scissors: Win'); addXP(5); unlockAchievement('gamer'); progressMission('game1',1); recordMatch('Rock Paper Scissors','Win'); }
    else if(result==='loss'){ submitScore('game', 3, 'Rock Paper Scissors: Loss'); recordMatch('Rock Paper Scissors','Loss'); }
    else { submitScore('game', 8, 'Rock Paper Scissors: Draw'); recordMatch('Rock Paper Scissors','Draw'); }
    const wrap=document.getElementById('rps-wrap');
    if(wrap) wrap.innerHTML = renderRPS();
    const resultEl=document.getElementById('rps-result');
    const roundLabel = `You: ${icons[you]}  AI: ${icons[ai]} — ${result==='win'?'You win this round! 🎉':result==='loss'?'AI wins this round.':"It's a draw."}`;
    if(rpsRound>=RPS_TOTAL_ROUNDS){
      const won = rpsScore.win>rpsScore.loss;
      toast(rpsScore.win===rpsScore.loss ? "🤝 Best of 10 tied!" : (won ? '🏁 You won the match! 🎉' : '🏁 AI won the match.'));
      if(won){ addCoins(10,'game'); submitScore('game', 40, 'Rock Paper Scissors: Match Win'); }
    } else if(resultEl){
      resultEl.textContent = roundLabel;
    }
    wireRPS();
  }));
  const newMatchBtn=document.getElementById('rps-new-match');
  if(newMatchBtn) newMatchBtn.addEventListener('click', ()=>{
    gatePlay('Rock Paper Scissors', 10, ()=>{
      rpsScore={win:0,loss:0,draw:0}; rpsRound=0; rpsCharged=true;
      const wrap=document.getElementById('rps-wrap');
      if(wrap) wrap.innerHTML = renderRPS();
      wireRPS();
    });
  });
}

const TYPING_SENTENCES = [
  'The quick brown fox jumps over the lazy dog.',
  'S2 Talk helps you practice interviews and build real skills.',
  'Consistent daily practice turns small habits into big results.',
  'Great code is simple, readable, and easy to maintain.',
  'Every expert was once a beginner who refused to give up.',
];
let typingState=null;
function renderTyping(){
  if(!typingState) typingState = { sentence: TYPING_SENTENCES[Math.floor(Math.random()*TYPING_SENTENCES.length)], startedAt:null, done:false };
  return `
    <p class="sub">Type this sentence as fast and accurately as you can:</p>
    <p class="item-card" style="font-weight:600;">${escapeHtml(typingState.sentence)}</p>
    <textarea class="ta" id="typing-input" rows="2" placeholder="Start typing here..." ${typingState.done?'disabled':''}></textarea>
    <p class="sub" id="typing-result">${typingState.done ? '' : 'Timer starts on your first keystroke.'}</p>
    <button class="btn btn-ghost btn-sm" id="typing-restart">New Sentence</button>
  `;
}
function wireTyping(){
  const input=document.getElementById('typing-input');
  if(input) {
    input.addEventListener('focus', ()=>{
      if(!typingCharged){
        input.blur();
        gatePlay('Typing Speed Test', 10, ()=>{ typingCharged=true; openModal(renderPlay()); setTimeout(()=>document.getElementById('typing-input')?.focus(), 50); });
      }
    });
    input.addEventListener('input', ()=>{
      if(!typingCharged) return;
      if(!typingState.startedAt) typingState.startedAt = Date.now();
      const val=input.value;
      if(val === typingState.sentence){
        typingState.done=true;
        const secs = Math.max(1, (Date.now()-typingState.startedAt)/1000);
        const words = typingState.sentence.split(' ').length;
        const wpm = Math.round((words/secs)*60);
        const resultEl=document.getElementById('typing-result');
        if(resultEl) resultEl.textContent = `🎉 ${wpm} WPM in ${secs.toFixed(1)}s — 100% accurate!`;
        input.disabled=true;
        addCoins(5,'game'); addXP(10); unlockAchievement('gamer'); progressMission('game1',1);
        submitScore('game', wpm, 'Typing Speed Test');
        recordMatch('Typing Speed Test', 'Win');
      }
    });
  }
  const restart=document.getElementById('typing-restart');
  if(restart) restart.addEventListener('click', ()=>{
    gatePlay('Typing Speed Test', 10, ()=>{
      typingState=null; typingCharged=true;
      const wrap=document.getElementById('typing-wrap');
      if(wrap){ wrap.innerHTML = renderTyping(); wireTyping(); setTimeout(()=>document.getElementById('typing-input')?.focus(), 50); }
    });
  });
}

let c4Board=null, c4Over=false, c4StartTime=null;
function setupConnectFour(){
  c4Board = Array.from({length:6}, ()=>Array(7).fill(null)); 
  c4Over=false; c4StartTime=Date.now();
  renderConnectFour();
}
function c4Winner(board){
  const dirs=[[0,1],[1,0],[1,1],[1,-1]];
  for(let r=0;r<6;r++) for(let c=0;c<7;c++){
    const v=board[r][c]; if(!v) continue;
    for(const [dr,dc] of dirs){
      let count=1;
      for(let k=1;k<4;k++){
        const nr=r+dr*k, nc=c+dc*k;
        if(nr<0||nr>5||nc<0||nc>6||board[nr][nc]!==v) break;
        count++;
      }
      if(count>=4) return v;
    }
  }
  return board.every(row=>row.every(cell=>cell)) ? 'draw' : null;
}
function renderConnectFour(){
  const wrap=document.getElementById('c4-wrap');
  if(!wrap) return;
  wrap.innerHTML = `<div class="c4-grid">
    ${c4Board.map((row,r)=>row.map((cell,c)=>`<div class="c4-cell" data-c4col="${c}">${cell==='R'?'<span class="c4-disc c4-red"></span>':cell==='Y'?'<span class="c4-disc c4-yellow"></span>':''}</div>`).join('')).join('')}
  </div>`;
  wrap.querySelectorAll('[data-c4col]').forEach(cell=>cell.addEventListener('click', ()=>{
    if(c4Over) return;
    const col=parseInt(cell.dataset.c4col);
    if(!c4Charged){
      gatePlay('Connect Four', 10, ()=>{ c4Charged=true; openModal(renderPlay()); document.querySelector(`[data-c4col="${col}"]`)?.click(); });
      return;
    }
    if(!c4Drop(col,'R')) return;
    let w=c4Winner(c4Board);
    if(!w){
      const validCols=[0,1,2,3,4,5,6].filter(c=>c4Board[0][c]===null);
      if(validCols.length){ c4Drop(validCols[Math.floor(Math.random()*validCols.length)],'Y'); w=c4Winner(c4Board); }
    }
    renderConnectFour();
    if(w){
      c4Over=true;
      const secs=Math.max(1, Math.round((Date.now()-c4StartTime)/1000));
      const result = w==='draw' ? 'Draw' : (w==='R' ? 'Win' : 'Loss');
      const points = w==='draw'?20:(w==='R'?60:10);
      const coins = w==='draw'?3:(w==='R'?12:2);
      addCoins(coins,'game'); addXP(w==='R'?12:5); unlockAchievement('gamer'); progressMission('game1',1);
      submitScore('game', points, 'Connect Four: '+result);
      recordMatch('Connect Four', result);
      setTimeout(()=>{
        toast(w==='draw'?"🤝 It's a draw!":w==='R'?'🎉 You win!':'🤖 AI wins!');
        if(currentModalView==='play' && overlay.style.display==='flex'){ openModal(gameSummaryHtml('Connect Four', result, secs, points, coins) + renderPlay()); }
      }, 300);
    }
  }));
}
function c4Drop(col, mark){
  for(let r=5;r>=0;r--){
    if(!c4Board[r][col]){ c4Board[r][col]=mark; return true; }
  }
  return false;
}

let g2048Board=null, g2048Over=false, g2048KeyHandler=null;
function setup2048(){
  g2048Board = Array.from({length:4}, ()=>Array(4).fill(0));
  g2048Over=false;
  g2048SpawnTile(); g2048SpawnTile();
  renderG2048();
  if(g2048KeyHandler) window.removeEventListener('keydown', g2048KeyHandler);
  g2048KeyHandler = (e)=>{
    const wrap=document.getElementById('g2048-wrap');
    if(!wrap || overlay.style.display!=='flex') return;
    const tag=(e.target&&e.target.tagName||'').toLowerCase();
    if(tag==='input'||tag==='textarea') return;
    const map={arrowup:'up',arrowdown:'down',arrowleft:'left',arrowright:'right'};
    const dir=map[e.key.toLowerCase()];
    if(!dir) return;
    e.preventDefault();
    if(!g2048Charged){
      gatePlay('2048', 10, ()=>{ g2048Charged=true; openModal(renderPlay()); });
      return;
    }
    if(g2048Move(dir)) { g2048SpawnTile(); renderG2048(); g2048CheckOver(); }
  };
  window.addEventListener('keydown', g2048KeyHandler);
}
function g2048SpawnTile(){
  const empties=[];
  for(let r=0;r<4;r++) for(let c=0;c<4;c++) if(!g2048Board[r][c]) empties.push([r,c]);
  if(!empties.length) return;
  const [r,c]=empties[Math.floor(Math.random()*empties.length)];
  g2048Board[r][c] = Math.random()<0.9 ? 2 : 4;
}
function g2048Move(dir){
  let moved=false;
  const rotate=(board)=>board[0].map((_,c)=>board.map(row=>row[c])); // transpose
  let board = g2048Board.map(r=>[...r]);
  function slideRowLeft(row){
    const vals=row.filter(v=>v);
    for(let i=0;i<vals.length-1;i++){
      if(vals[i]===vals[i+1]){ vals[i]*=2; addCoins(0); vals.splice(i+1,1); }
    }
    while(vals.length<4) vals.push(0);
    return vals;
  }
  if(dir==='left'){ board = board.map(row=>slideRowLeft(row)); }
  else if(dir==='right'){ board = board.map(row=>slideRowLeft([...row].reverse()).reverse()); }
  else if(dir==='up'){ let t=rotate(board); t=t.map(row=>slideRowLeft(row)); board=rotate(t); }
  else if(dir==='down'){ let t=rotate(board); t=t.map(row=>slideRowLeft([...row].reverse()).reverse()); board=rotate(t); }
  moved = JSON.stringify(board)!==JSON.stringify(g2048Board);
  g2048Board = board;
  return moved;
}
function renderG2048(){
  const wrap=document.getElementById('g2048-wrap');
  if(!wrap) return;
  wrap.innerHTML = `<div class="g2048-grid">${g2048Board.flat().map(v=>`<div class="g2048-cell g2048-${v}">${v||''}</div>`).join('')}</div>`;
}
function g2048CheckOver(){
  const hasEmpty = g2048Board.some(row=>row.some(v=>!v));
  const hasMove = ['left','right','up','down'].some(dir=>{
    const before=JSON.stringify(g2048Board);
    const copy=g2048Board.map(r=>[...r]);
    g2048Move(dir);
    const after=JSON.stringify(g2048Board);
    g2048Board = copy; // g2048Move mutates the real board — restore it, this is just a probe
    return before!==after;
  });
  const won = g2048Board.some(row=>row.some(v=>v>=2048));
  if(won && !g2048Over){
    g2048Over=true;
    const score=g2048Board.flat().reduce((a,b)=>a+b,0);
    addCoins(15,'game'); addXP(20); unlockAchievement('gamer'); progressMission('game1',1);
    submitScore('game', score, '2048: Reached 2048!');
    recordMatch('2048', 'Win');
    toast('🎉 You reached 2048!');
  } else if(!hasEmpty && !hasMove && !g2048Over){
    g2048Over=true;
    const score=g2048Board.flat().reduce((a,b)=>a+b,0);
    submitScore('game', Math.round(score/10), '2048: Game over');
    recordMatch('2048', 'Loss');
    toast('Game over — no more moves. Final score: '+score);
  }
}

function wireModalExtras(){
  const h2 = document.querySelector('#modal h2');
  if(!h2) return;
  const t = h2.textContent;
  if(t.includes('Interview House')) wireInterview();
  else if(t.includes('Skills Development House')) wireSkills();
  else if(t.includes('— Quiz')) wireSkills();
  else if(t.includes('Projects Lab')) wireLab();
  else if(t.includes('Talk House')) wireTalk();
  else if(t.includes('S2 AI Agent')){
    document.querySelectorAll('.quick-q').forEach(q=>q.addEventListener('click', ()=>sendAI(q.dataset.q)));
    const sendBtn=document.getElementById('ai-send');
    if(sendBtn) sendBtn.addEventListener('click', ()=>{ const v=document.getElementById('ai-input').value.trim(); if(v) sendAI(v); });
    const input=document.getElementById('ai-input');
    if(input) input.addEventListener('keydown', e=>{ if(e.key==='Enter'){ const v=input.value.trim(); if(v) sendAI(v); } });
    const historyToggle=document.getElementById('ai-history-toggle');
    if(historyToggle) historyToggle.addEventListener('click', ()=>{ aiHistoryPanelOpen = !aiHistoryPanelOpen; openModal(renderAI()); });
    const historyClose=document.getElementById('ai-history-close');
    if(historyClose) historyClose.addEventListener('click', ()=>{ aiHistoryPanelOpen = false; openModal(renderAI()); });
    const newChatBtn=document.getElementById('ai-newchat');
    if(newChatBtn) newChatBtn.addEventListener('click', ()=>{
      if(aiHistory.length) aiPersistCurrentSession();
      aiHistory = [];
      aiCurrentSessionId = null;
      saveUserData();
      openModal(renderAI());
      toast('🆕 New chat started.');
    });
    const historySearch=document.getElementById('ai-history-search');
    if(historySearch){
      historySearch.addEventListener('input', ()=>{ aiSearchQuery = historySearch.value; openModal(renderAI()); historySearch.focus(); });
      const pos = historySearch.value.length; historySearch.setSelectionRange(pos,pos);
    }
    document.querySelectorAll('[data-open-ai-chat]').forEach(el=>el.addEventListener('click', (e)=>{
      if(e.target.closest('[data-rename-ai-chat]') || e.target.closest('[data-delete-ai-chat]')) return;
      const id = el.dataset.openAiChat;
      if(aiHistory.length && aiCurrentSessionId !== id) aiPersistCurrentSession();
      const s = aiSessions.find(x=>x.id===id);
      if(s){ aiHistory = s.messages; aiCurrentSessionId = s.id; aiHistoryPanelOpen = false; saveUserData(); openModal(renderAI()); }
    }));
    document.querySelectorAll('[data-rename-ai-chat]').forEach(b=>b.addEventListener('click', (e)=>{
      e.stopPropagation();
      const s = aiSessions.find(x=>x.id===b.dataset.renameAiChat);
      if(!s) return;
      const name = prompt('Rename chat:', s.title);
      if(name && name.trim()){ s.title = aiMakeTitle(name.trim()); saveUserData(); openModal(renderAI()); }
    }));
    document.querySelectorAll('[data-delete-ai-chat]').forEach(b=>b.addEventListener('click', (e)=>{
      e.stopPropagation();
      const id = b.dataset.deleteAiChat;
      if(!confirm('Delete this chat? This cannot be undone.')) return;
      aiSessions = aiSessions.filter(x=>x.id!==id);
      if(aiCurrentSessionId===id){ aiHistory=[]; aiCurrentSessionId=null; }
      saveUserData();
      openModal(renderAI());
      toast('🗑️ Chat deleted.');
    }));
    const micBtn=document.getElementById('ai-mic');
    if(micBtn){
      const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
      micBtn.addEventListener('click', ()=>{
        if(!SR){ toast('🎙️ Speech recognition is not supported in this browser.'); return; }
        navigator.mediaDevices?.getUserMedia?.({audio:true}).then(s=>{
          s.getTracks().forEach(tr=>tr.stop()); // only confirming permission, not keeping the stream open
          const rec = new SR(); rec.lang='en-US'; rec.interimResults=false;
          micBtn.textContent='●'; toast('🎙️ Listening...');
          rec.onresult = e=>{ document.getElementById('ai-input').value = e.results[0][0].transcript; micBtn.textContent='🎙️'; };
          rec.onerror = ()=>{ micBtn.textContent='🎙️'; toast('Could not capture audio — check microphone permission.'); };
          rec.onend = ()=>{ micBtn.textContent='🎙️'; };
          rec.start();
        }).catch(()=>{ toast('🎙️ Microphone permission denied.'); });
      });
    }
  }
  else if(t.includes('Contacts House')) wireContacts();
  else if(t.includes('Results House')) wireResults();
  else if(t.includes('Settings House')) wireSettings();
  else if(t.includes('Play House')) wirePlay();
  else if(t.includes('Daily Missions')){
    document.querySelectorAll('[data-claim]').forEach(b=>b.addEventListener('click', ()=>{
      const m=AppState.missions[b.dataset.claim];
      if(m && m.progress>=m.target && !m.claimed){
        m.claimed=true; addXP(m.reward);
        toast('🎯 Mission complete! +'+m.reward+' coins');
        pushNotification('🎯 Mission complete: '+m.label+' (+'+m.reward+' coins)');
        openModal(renderMissions());
      }
    }));
  }
}

})();

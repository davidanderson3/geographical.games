// Client-side Google Sign-In via Firebase Auth (modular SDK via ESM CDN)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-auth.js';

let app = null;
let auth = null;

async function loadFirebaseConfig(){
  try {
    const res = await fetch('firebase-config.json', { cache: 'no-store' });
    if(!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function verifyWithBackend(idToken){
  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
    if(res.ok){
      const data = await res.json();
      console.log('Auth verified by backend:', data && data.user);
    } else {
      console.warn('Backend auth verify failed', res.status);
    }
  } catch (e) {
    console.warn('Backend auth verify error', e && e.message);
  }
}

export async function initAuthUI(){
  const cfg = await loadFirebaseConfig();
  const btn = document.getElementById('authBtn');
  const userInfo = document.getElementById('userInfo');
  if(!btn || !userInfo){ return; }

  if(!cfg){
    btn.disabled = true;
    btn.textContent = 'Auth not configured';
    userInfo.textContent = '';
    return;
  }

  if(!app) app = initializeApp(cfg);
  if(!auth) auth = getAuth(app);
  const provider = new GoogleAuthProvider();

  function updateUI(user){
    if(user){
      const name = user.displayName || user.email || user.uid;
      userInfo.textContent = name;
      btn.textContent = 'Sign out';
    } else {
      userInfo.textContent = '';
      btn.textContent = 'Sign in with Google';
    }
  }

  onAuthStateChanged(auth, async (user) => {
    updateUI(user);
    if(user){
      try {
        const idToken = await user.getIdToken();
        await verifyWithBackend(idToken);
      } catch {}
    }
  });

  btn.addEventListener('click', async () => {
    const user = auth.currentUser;
    if(user){
      try { await signOut(auth); } catch {}
      return;
    }
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.warn('Sign-in failed:', e && e.message);
    }
  });
}

if(typeof window !== 'undefined') window.initAuthUI = initAuthUI;


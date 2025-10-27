// Client-side Google Sign-In via Firebase Auth (modular SDK via ESM CDN)
console.log('auth.js loaded');
  console.log('initAuthUI called');
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-auth.js';
import { apiFetch } from './apiClient.js';

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
    const res = await apiFetch('/api/auth/verify', {
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

async function initAuthUI(){
  const cfg = window.FIREBASE_CONFIG || await loadFirebaseConfig();
  console.log('Firebase config:', JSON.stringify(cfg));
  if (!cfg.apiKey || !cfg.authDomain || !cfg.projectId) {
    console.error('Firebase config missing required fields:', cfg);
  }
  const btn = document.getElementById('authBtn');
  const userInfo = document.getElementById('userInfo');
  console.log('Auth button:', btn);
  if(!btn || !userInfo){
    console.error('Auth button or user info element not found');
    return;
  }
  btn.textContent = 'Sign in with Google (ready)';

  if(!cfg){
    btn.disabled = true;
    btn.textContent = 'Auth not configured';
    userInfo.textContent = '';
    console.error('No Firebase config found');
    return;
  }

  if(!app) app = initializeApp(cfg);
  if(!auth) auth = getAuth(app);
  console.log('Firebase Auth initialized');
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
    console.log('Sign-in button clicked');
    const user = auth.currentUser;
    if(user){
      try { await signOut(auth); } catch {}
      return;
    }
    try {
      console.log('Attempting sign in with config:', JSON.stringify(cfg));
      await signInWithPopup(auth, provider);
      console.log('Sign in successful');
    } catch (e) {
      console.error('Sign-in failed:', e);
      btn.textContent = 'Sign in failed';
      btn.style.background = '#c00';
      btn.style.color = '#fff';
      userInfo.textContent = e.message || 'Sign-in error';
    }
  });
}


if(typeof window !== 'undefined') {
  window.initAuthUI = initAuthUI;
  if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.initAuthUI();
    });
  } else {
    window.initAuthUI();
  }
}

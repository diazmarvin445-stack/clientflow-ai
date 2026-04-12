/**
 * ClientFlow AI — Firebase (modular SDK)
 * Ensure Firestore rules allow authenticated writes to `businesses`. Onboarding usa cuenta con correo (mismo uid que el panel).
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDYqbVqMTR0jnQzm-YDThfFcFz9__fmbTI",
  authDomain: "clientflow-ai-7eb08.firebaseapp.com",
  projectId: "clientflow-ai-7eb08",
  storageBucket: "clientflow-ai-7eb08.firebasestorage.app",
  messagingSenderId: "299452046381",
  appId: "1:299452046381:web:9fc81e4bc940bd4dfa2ca4",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);

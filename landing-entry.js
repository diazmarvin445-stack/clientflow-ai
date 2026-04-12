/**
 * Landing page: "Ya tengo cuenta" / entry links go to dashboard when signed in, else login.
 */
import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

function applyEntryTargets() {
  const dest = auth.currentUser ? "dashboard.html" : "login.html";
  document.querySelectorAll("[data-landing-entry]").forEach((el) => {
    if (el.tagName === "A") {
      el.setAttribute("href", dest);
    }
  });
}

onAuthStateChanged(auth, applyEntryTargets);

if (typeof auth.authStateReady === "function") {
  auth.authStateReady().then(applyEntryTargets);
}

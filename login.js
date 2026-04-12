import { auth } from "./firebase.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const formSignIn = document.getElementById("login-form");
const formSignUp = document.getElementById("signup-form");
const errSignIn = document.getElementById("login-error");
const errSignUp = document.getElementById("signup-error");
const toggleToSignup = document.getElementById("toggle-signup");
const toggleToLogin = document.getElementById("toggle-login");
const authPanels = document.getElementById("auth-panels");
const forgotBtn = document.getElementById("login-forgot");

function showError(el, msg) {
  if (!el) return;
  el.textContent = msg || "";
  el.hidden = !msg;
}

function goDashboard() {
  window.location.replace("dashboard.html");
}

function hasSignedInAccount(user) {
  return Boolean(user && !user.isAnonymous);
}

onAuthStateChanged(auth, (user) => {
  if (hasSignedInAccount(user)) goDashboard();
});

if (typeof auth.authStateReady === "function") {
  auth.authStateReady().then(() => {
    if (hasSignedInAccount(auth.currentUser)) goDashboard();
  });
}

if (toggleToSignup && toggleToLogin && authPanels) {
  toggleToSignup.addEventListener("click", (e) => {
    e.preventDefault();
    authPanels.setAttribute("data-view", "signup");
    showError(errSignIn, "");
    showError(errSignUp, "");
  });
  toggleToLogin.addEventListener("click", (e) => {
    e.preventDefault();
    authPanels.setAttribute("data-view", "signin");
    showError(errSignIn, "");
    showError(errSignUp, "");
  });
}

if (formSignIn) {
  formSignIn.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError(errSignIn, "");

    const email = formSignIn.querySelector('[name="email"]')?.value?.trim() || "";
    const password = formSignIn.querySelector('[name="password"]')?.value || "";
    if (!email || !password) {
      showError(errSignIn, "Introduce correo y contraseña.");
      return;
    }

    const btn = formSignIn.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);
      goDashboard();
    } catch (err) {
      const code = err && err.code;
      let msg = "No se pudo iniciar sesión. Inténtalo de nuevo.";
      if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
        msg = "Correo o contraseña incorrectos.";
      } else if (code === "auth/user-not-found") {
        msg = "No hay cuenta con ese correo. Puedes crear una abajo o usar «Probar Plataforma» sin correo.";
      } else if (code === "auth/too-many-requests") {
        msg = "Demasiados intentos. Espera un momento e inténtalo de nuevo.";
      } else if (err && err.message) {
        msg = err.message;
      }
      showError(errSignIn, msg);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
      }
    }
  });
}

if (formSignUp) {
  formSignUp.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError(errSignUp, "");

    const email = formSignUp.querySelector('[name="email"]')?.value?.trim() || "";
    const password = formSignUp.querySelector('[name="password"]')?.value || "";
    const password2 = formSignUp.querySelector('[name="password2"]')?.value || "";

    if (!email || !password) {
      showError(errSignUp, "Completa correo y contraseña.");
      return;
    }
    if (password.length < 6) {
      showError(errSignUp, "La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (password !== password2) {
      showError(errSignUp, "Las contraseñas no coinciden.");
      return;
    }

    const btn = formSignUp.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
    }

    try {
      await createUserWithEmailAndPassword(auth, email, password);
      window.location.assign("onboarding.html");
    } catch (err) {
      const code = err && err.code;
      let msg = "No se pudo crear la cuenta.";
      if (code === "auth/email-already-in-use") {
        msg = "Ese correo ya tiene cuenta. Inicia sesión en el otro panel.";
      } else if (code === "auth/weak-password") {
        msg = "Elige una contraseña más segura.";
      } else if (err && err.message) {
        msg = err.message;
      }
      showError(errSignUp, msg);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
      }
    }
  });
}

if (forgotBtn && formSignIn) {
  forgotBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = formSignIn.querySelector('[name="email"]')?.value?.trim();
    if (!email) {
      showError(errSignIn, "Escribe tu correo arriba y pulsa de nuevo para enviar el enlace.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      showError(errSignIn, "Si existe una cuenta, te hemos enviado un correo para restablecer la contraseña.");
    } catch (err) {
      showError(errSignIn, "No se pudo enviar el correo. Comprueba la dirección.");
    }
  });
}

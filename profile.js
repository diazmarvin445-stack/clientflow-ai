import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  resolveBusinessForUser,
  formatBusinessMeta,
  initialsFromName,
  clearStoredPrimaryBusiness,
} from "./dashboard-data.js";
import { initDashShell, openComingSoon } from "./dash-shell.js";

function renderHeader(business) {
  const nameEl = document.getElementById("dash-business-name");
  const metaEl = document.getElementById("dash-business-meta");
  const av = document.getElementById("dash-avatar-initials");

  if (!business) {
    if (nameEl) nameEl.textContent = "Mi perfil";
    if (metaEl) metaEl.textContent = "Cuenta";
    if (av) av.textContent = "?";
    return;
  }

  const { data } = business;
  const displayName =
    (typeof data.businessName === "string" && data.businessName.trim()) || "Tu negocio";
  const { metaLine } = formatBusinessMeta(data);

  if (nameEl) nameEl.textContent = displayName;
  if (metaEl) metaEl.textContent = metaLine;
  if (av) av.textContent = initialsFromName(displayName);
}

function boot() {
  initDashShell({ auth });

  const emailEl = document.getElementById("profile-email");
  const uidEl = document.getElementById("profile-uid");
  const signOutBtn = document.getElementById("profile-signout");

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }

    if (emailEl) emailEl.textContent = user.email || "—";
    if (uidEl) uidEl.textContent = user.uid;

    try {
      const business = await resolveBusinessForUser(db, user);
      renderHeader(business);
    } catch (e) {
      console.error(e);
      renderHeader(null);
    }
  });

  if (signOutBtn) {
    signOutBtn.addEventListener("click", async () => {
      try {
        clearStoredPrimaryBusiness();
        await signOut(auth);
        window.location.href = "login.html";
      } catch (err) {
        console.error(err);
        openComingSoon("No se pudo cerrar sesión", "Recarga la página e inténtalo de nuevo.");
      }
    });
  }
}

boot();

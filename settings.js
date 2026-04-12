import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { fetchBusinessForOwner, formatBusinessMeta, initialsFromName } from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";

function renderHeader(business) {
  const nameEl = document.getElementById("dash-business-name");
  const metaEl = document.getElementById("dash-business-meta");
  const av = document.getElementById("dash-avatar-initials");

  if (!business) {
    if (nameEl) nameEl.textContent = "Configuración";
    if (metaEl) metaEl.textContent = "Plan Pro · —";
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

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.replace("onboarding.html");
      return;
    }
    try {
      const business = await fetchBusinessForOwner(db, user.uid);
      renderHeader(business);
    } catch (e) {
      console.error(e);
      renderHeader(null);
    }
  });
}

boot();

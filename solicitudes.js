import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  fetchBusinessForOwner,
  fetchDashboardMetrics,
  formatBusinessMeta,
  initialsFromName,
  renderLeadsTbody,
} from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";

function renderHeader(business) {
  const nameEl = document.getElementById("dash-business-name");
  const metaEl = document.getElementById("dash-business-meta");
  const av = document.getElementById("dash-avatar-initials");

  if (!business) {
    if (nameEl) nameEl.textContent = "Tu negocio";
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

async function loadSolicitudesForUser(user) {
  const business = await fetchBusinessForOwner(db, user.uid);
  renderHeader(business);

  const tbody = document.getElementById("dash-leads-tbody");
  if (!business) {
    renderLeadsTbody(tbody, []);
    return;
  }

  const metrics = await fetchDashboardMetrics(db, business.id);
  renderLeadsTbody(tbody, metrics.recentLeads);
}

function boot() {
  initDashShell({ auth });

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    loadSolicitudesForUser(user).catch((err) => {
      console.error(err);
      renderHeader(null);
      renderLeadsTbody(document.getElementById("dash-leads-tbody"), []);
    });
  });
}

boot();

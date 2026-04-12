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

function formatUsd(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

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

function renderMetrics(metrics) {
  setText("dash-metric-leads", String(metrics.leadsToday));
  setText("dash-metric-jobs", String(metrics.jobsConfirmed));
  setText("dash-metric-revenue", formatUsd(metrics.revenueSum));
  setText("dash-metric-campaigns", String(metrics.campaignsActive));

  setText("dash-trend-leads", "Hoy");
  setText("dash-trend-jobs", "Confirmados");
  setText("dash-trend-revenue", "Estimado");
  setText("dash-trend-campaigns", "Activas");
}

function renderLeadsTable(leads) {
  const tbody = document.getElementById("dash-leads-tbody");
  renderLeadsTbody(tbody, leads);
}

async function loadDashboardForUser(user) {
  const business = await fetchBusinessForOwner(db, user.uid);
  renderHeader(business);

  if (!business) {
    renderMetrics({
      leadsToday: 0,
      jobsConfirmed: 0,
      revenueSum: 0,
      campaignsActive: 0,
    });
    renderLeadsTable([]);
    return;
  }

  const metrics = await fetchDashboardMetrics(db, business.id);
  renderMetrics(metrics);
  renderLeadsTable(metrics.recentLeads);
}

function boot() {
  initDashShell({ auth });

  let tabWasHidden = false;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      tabWasHidden = true;
      return;
    }
    if (document.visibilityState !== "visible" || !tabWasHidden) return;
    tabWasHidden = false;
    const user = auth.currentUser;
    if (user) {
      loadDashboardForUser(user).catch((err) => console.error(err));
    }
  });

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace("onboarding.html");
      return;
    }
    loadDashboardForUser(user).catch((err) => {
      console.error(err);
      renderHeader(null);
      renderMetrics({
        leadsToday: 0,
        jobsConfirmed: 0,
        revenueSum: 0,
        campaignsActive: 0,
      });
      renderLeadsTable([]);
    });
  });
}

boot();

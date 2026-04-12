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

function greetingForHour() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

function displayNameForWelcome(business, user) {
  const fromBiz =
    business?.data &&
    typeof business.data.businessName === "string" &&
    business.data.businessName.trim();
  if (fromBiz) return fromBiz.trim();
  if (user?.displayName && String(user.displayName).trim()) return String(user.displayName).trim();
  if (user?.email) return user.email.split("@")[0];
  return "tu equipo";
}

function renderWelcome(business, user) {
  const greetEl = document.getElementById("dash-welcome-greet");
  const leadEl = document.getElementById("dash-welcome-lead");
  if (!greetEl || !leadEl) return;

  const name = displayNameForWelcome(business, user);
  greetEl.textContent = `${greetingForHour()}, ${name} 👋`;
  leadEl.textContent = "Este es el resumen de tu negocio hoy.";
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

function setTrendPill(el, dir, pillText, noteText) {
  if (!el) return;
  el.innerHTML = "";
  const pill = document.createElement("span");
  pill.className = `dash-stat-trend-pill dash-stat-trend-pill--${dir}`;
  pill.textContent = pillText;
  const note = document.createElement("span");
  note.className = "dash-stat-trend-note";
  note.textContent = noteText;
  el.appendChild(pill);
  el.appendChild(note);
}

function trendLeadsVsYesterday(today, yesterday) {
  if (today === 0 && yesterday === 0) {
    return { dir: "neutral", pill: "—", note: "Sin leads ayer" };
  }
  if (yesterday === 0) {
    return {
      dir: "up",
      pill: `+${today}`,
      note: "nuevos vs. ayer",
    };
  }
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  if (pct > 0) {
    return { dir: "up", pill: `+${pct}%`, note: "vs. ayer" };
  }
  if (pct < 0) {
    return { dir: "down", pill: `${pct}%`, note: "vs. ayer" };
  }
  return { dir: "neutral", pill: "0%", note: "vs. ayer" };
}

function renderMetrics(metrics) {
  setText("dash-metric-leads", String(metrics.leadsToday));
  setText("dash-metric-jobs", String(metrics.jobsConfirmed));
  setText("dash-metric-revenue", formatUsd(metrics.revenueSum));
  setText("dash-metric-campaigns", String(metrics.campaignsActive));

  const ly = typeof metrics.leadsYesterday === "number" ? metrics.leadsYesterday : 0;
  const lt = trendLeadsVsYesterday(metrics.leadsToday, ly);
  setTrendPill(document.getElementById("dash-trend-leads"), lt.dir, lt.pill, lt.note);

  if (metrics.jobsConfirmed > 0) {
    setTrendPill(document.getElementById("dash-trend-jobs"), "up", "●", "Cartera activa");
  } else {
    setTrendPill(document.getElementById("dash-trend-jobs"), "neutral", "—", "Sin trabajos aún");
  }

  if (metrics.revenueSum > 0) {
    setTrendPill(document.getElementById("dash-trend-revenue"), "up", "↑", "Según trabajos cerrados");
  } else {
    setTrendPill(document.getElementById("dash-trend-revenue"), "neutral", "—", "Sin ingresos proyectados");
  }

  if (metrics.campaignsActive > 0) {
    setTrendPill(
      document.getElementById("dash-trend-campaigns"),
      "up",
      String(metrics.campaignsActive),
      "campañas IA activas",
    );
  } else {
    setTrendPill(document.getElementById("dash-trend-campaigns"), "neutral", "—", "Sin campañas activas");
  }
}

function renderLeadsTable(leads) {
  const tbody = document.getElementById("dash-leads-tbody");
  renderLeadsTbody(tbody, leads, { emptyState: "dashboard" });
}

async function loadDashboardForUser(user) {
  const business = await fetchBusinessForOwner(db, user.uid);
  renderHeader(business);
  renderWelcome(business, user);

  if (!business) {
    renderMetrics({
      leadsToday: 0,
      leadsYesterday: 0,
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
      window.location.replace("login.html");
      return;
    }
    loadDashboardForUser(user).catch((err) => {
      console.error(err);
      renderHeader(null);
      renderWelcome(null, user);
      renderMetrics({
        leadsToday: 0,
        leadsYesterday: 0,
        jobsConfirmed: 0,
        revenueSum: 0,
        campaignsActive: 0,
      });
      renderLeadsTable([]);
    });
  });
}

boot();

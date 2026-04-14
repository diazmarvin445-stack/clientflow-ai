import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  resolveBusinessForUser,
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

function renderGreeting() {
  const el = document.getElementById("dash-greeting");
  if (el) el.textContent = greetingForHour();
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

function renderCampaignSummary(snapshot) {
  const section = document.getElementById("dash-campaign-summary");
  if (!section) return;
  if (!snapshot) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  setText("dash-campaign-title", snapshot.title);
  setText("dash-campaign-platform", snapshot.platform);
  setText(
    "dash-campaign-reach",
    snapshot.reachEstimate != null ? snapshot.reachEstimate.toLocaleString("es") : "—",
  );
  setText(
    "dash-campaign-clicks",
    snapshot.clicks != null ? String(snapshot.clicks) : "—",
  );
  setText("dash-campaign-leads", String(snapshot.leadsWeeklyEst));
  const hint = document.getElementById("dash-campaign-hint");
  if (hint) hint.hidden = true;
}

function renderMetrics(metrics) {
  setText("dash-metric-leads", String(metrics.leadsToday));
  setText("dash-metric-jobs", String(metrics.jobsConfirmed));
  setText("dash-metric-revenue", formatUsd(metrics.revenueSum));
  setText("dash-metric-campaigns", String(metrics.campaignsActive));

  renderCampaignSummary(metrics.activeCampaignSnapshot ?? null);

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
  const business = await resolveBusinessForUser(db, user);
  renderHeader(business);
  renderGreeting();

  if (!business) {
    renderMetrics({
      leadsToday: 0,
      leadsYesterday: 0,
      jobsConfirmed: 0,
      revenueSum: 0,
      campaignsActive: 0,
      activeCampaignSnapshot: null,
    });
    renderLeadsTable([]);
    return;
  }

  const metrics = await fetchDashboardMetrics(db, business.id, user.uid);
  console.log(
    "[ClientFlow dashboard] recentLeads for table:",
    metrics.recentLeads.length,
    "primary businessId:",
    business.id,
    "owner uid:",
    user.uid,
  );
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
      renderGreeting();
      renderMetrics({
        leadsToday: 0,
        leadsYesterday: 0,
        jobsConfirmed: 0,
        revenueSum: 0,
        campaignsActive: 0,
        activeCampaignSnapshot: null,
      });
      renderLeadsTable([]);
    });
  });
}

boot();

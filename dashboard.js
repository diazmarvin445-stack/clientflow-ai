import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  fetchBusinessForOwner,
  fetchDashboardMetrics,
  formatBusinessMeta,
  initialsFromName,
  leadStatusPresentation,
  formatShortDate,
  SERVICE_LABELS,
} from "./dashboard-data.js";

function initSidebar() {
  const sidebar = document.getElementById("dash-sidebar");
  const overlay = document.getElementById("dash-sidebar-overlay");
  const menuBtn = document.getElementById("dash-menu-btn");

  function openMenu() {
    if (!sidebar || !menuBtn) return;
    sidebar.classList.add("is-open");
    if (overlay) overlay.hidden = false;
    menuBtn.setAttribute("aria-expanded", "true");
    document.body.classList.add("dash-menu-open");
  }

  function closeMenu() {
    if (!sidebar || !menuBtn) return;
    sidebar.classList.remove("is-open");
    if (overlay) overlay.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("dash-menu-open");
  }

  function toggleMenu() {
    if (sidebar && sidebar.classList.contains("is-open")) closeMenu();
    else openMenu();
  }

  if (menuBtn) menuBtn.addEventListener("click", toggleMenu);
  if (overlay) overlay.addEventListener("click", closeMenu);

  sidebar &&
    sidebar.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        if (window.matchMedia("(max-width: 1024px)").matches) closeMenu();
      });
    });

  window.addEventListener("resize", () => {
    if (window.matchMedia("(min-width: 1025px)").matches) closeMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
}

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
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!leads.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.className = "dash-table-muted";
    td.textContent = "Sin solicitudes aún";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  leads.forEach((lead) => {
    const tr = document.createElement("tr");
    const client =
      lead.customerName || lead.clientName || lead.name || lead.contactName || "—";
    const rawSvc = lead.service || lead.serviceLabel || lead.serviceType || "";
    const service = rawSvc
      ? SERVICE_LABELS[rawSvc] || rawSvc
      : "—";
    const pres = leadStatusPresentation(lead.status);
    const dateStr = formatShortDate(lead.createdAt);

    const tdClient = document.createElement("td");
    tdClient.textContent = client;

    const tdService = document.createElement("td");
    tdService.textContent = service;

    const tdState = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `dash-badge ${pres.className}`;
    badge.textContent = pres.label;
    tdState.appendChild(badge);

    const tdDate = document.createElement("td");
    tdDate.className = "dash-table-muted";
    tdDate.textContent = dateStr;

    tr.appendChild(tdClient);
    tr.appendChild(tdService);
    tr.appendChild(tdState);
    tr.appendChild(tdDate);
    tbody.appendChild(tr);
  });
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
  initSidebar();

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

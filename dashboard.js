import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  resolveBusinessForUser,
  fetchDashboardMetrics,
  formatBusinessMeta,
  initialsFromName,
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

let ordersUnsub = null;

function formatShortDate(value) {
  if (!value) return "—";
  let d = null;
  if (typeof value.toDate === "function") {
    try {
      d = value.toDate();
    } catch (_) {
      d = null;
    }
  } else if (value instanceof Date) {
    d = value;
  } else {
    d = new Date(value);
  }
  if (!d || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}

function orderStatusLabel(raw) {
  const key = String(raw || "").toLowerCase().trim();
  if (key === "completed" || key === "entregado") return "Entregado";
  if (key === "in_production" || key === "produccion") return "En producción";
  if (key === "confirmed" || key === "confirmado") return "Confirmado";
  if (key === "cancelled" || key === "cancelado") return "Cancelado";
  if (key === "new" || key === "pendiente") return "Pendiente";
  return "Pendiente";
}

function orderStatusBadgeClass(raw) {
  const key = String(raw || "").toLowerCase().trim();
  if (key === "completed" || key === "entregado") return "dash-badge--done";
  if (key === "in_production" || key === "produccion") return "dash-badge--sched";
  if (key === "cancelled" || key === "cancelado") return "dash-badge--cancelled";
  return "dash-badge--prog";
}

function clearOrdersSubscription() {
  if (ordersUnsub) {
    ordersUnsub();
    ordersUnsub = null;
  }
}

function renderOrdersRows(businessId, rows) {
  const tbody = document.getElementById("dash-orders-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "dash-table-muted";
    td.textContent = "Aún no hay pedidos. Cuando Maya cierre ventas, aparecerán aquí.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const client = row.customerName || row.clientName || "—";
    const orderTitle = row.title || row.product || "Pedido";
    const status = orderStatusLabel(row.status);
    const created = formatShortDate(row.createdAt);

    const tdClient = document.createElement("td");
    tdClient.textContent = String(client);

    const tdOrder = document.createElement("td");
    tdOrder.textContent = String(orderTitle);

    const tdStatus = document.createElement("td");
    const statusBadge = document.createElement("span");
    statusBadge.className = `dash-badge ${orderStatusBadgeClass(row.status)}`;
    statusBadge.textContent = status;
    tdStatus.appendChild(statusBadge);

    const tdDate = document.createElement("td");
    tdDate.className = "dash-table-muted";
    tdDate.textContent = created;

    const tdAction = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "dash-icon-btn";
    delBtn.title = "Eliminar pedido";
    delBtn.setAttribute("aria-label", "Eliminar pedido");
    delBtn.textContent = "🗑️";
    delBtn.addEventListener("click", async () => {
      const ok = window.confirm("¿Eliminar este pedido? Esta acción no se puede deshacer.");
      if (!ok) return;
      try {
        await deleteDoc(doc(db, "businesses", businessId, "orders", row.id));
      } catch (err) {
        console.error("[ClientFlow dashboard] delete order", err);
        window.alert("No se pudo eliminar el pedido.");
      }
    });
    tdAction.appendChild(delBtn);

    tr.append(tdClient, tdOrder, tdStatus, tdDate, tdAction);
    tbody.appendChild(tr);
  });
}

function subscribeRecentOrders(businessId) {
  clearOrdersSubscription();
  const q = query(
    collection(db, "businesses", businessId, "orders"),
    orderBy("createdAt", "desc"),
    limit(10),
  );
  ordersUnsub = onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderOrdersRows(businessId, rows);
    },
    (err) => {
      console.error("[ClientFlow dashboard] orders snapshot", err);
      renderOrdersRows(businessId, []);
    },
  );
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
    clearOrdersSubscription();
    renderOrdersRows("", []);
    return;
  }

  subscribeRecentOrders(business.id);
  const metrics = await fetchDashboardMetrics(db, business.id, user.uid);
  renderMetrics(metrics);
}

function boot() {
  initDashShell({ auth, db });

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
      clearOrdersSubscription();
      renderOrdersRows("", []);
    });
  });
}

boot();

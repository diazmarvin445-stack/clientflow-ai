import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  resolveBusinessForUser,
  fetchCampaignsListAndStats,
  fetchClientsForBusiness,
  fetchFinanceTransactionsForBusiness,
  formatBusinessMeta,
  fetchJobsForBusiness,
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

function drawSalesChart(canvas, dailyTotals) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width = canvas.clientWidth || 900;
  const h = canvas.height = 180;
  ctx.clearRect(0, 0, w, h);
  const vals = dailyTotals.length ? dailyTotals : [0];
  const max = Math.max(...vals, 1);
  const pad = 20;
  const bw = (w - pad * 2) / vals.length;
  ctx.fillStyle = "#2563eb";
  vals.forEach((v, i) => {
    const bh = ((h - 36) * v) / max;
    const x = pad + i * bw + bw * 0.15;
    const y = h - 16 - bh;
    ctx.fillRect(x, y, bw * 0.7, bh);
  });
  ctx.strokeStyle = "#cbd5e1";
  ctx.beginPath();
  ctx.moveTo(pad, h - 16);
  ctx.lineTo(w - pad, h - 16);
  ctx.stroke();
}

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

async function loadDashboardForUser(user) {
  const business = await resolveBusinessForUser(db, user);
  renderHeader(business);
  renderGreeting();

  if (!business) {
    return;
  }

  const [ordersSnap, clients, campaigns, financeRows, calSnap] = await Promise.all([
    getDocs(query(collection(db, "businesses", business.id, "orders"), orderBy("createdAt", "desc"))),
    fetchClientsForBusiness(db, business.id),
    fetchCampaignsListAndStats(db, business.id),
    fetchFinanceTransactionsForBusiness(db, business.id, 500),
    getDocs(query(collection(db, "businesses", business.id, "calendar"), orderBy("date", "asc"))),
  ]);

  const orders = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const activeOrders = orders.filter((o) => !["entregado", "cancelado"].includes(String(o.status || "").toLowerCase()));
  const pendingPayments = orders.filter((o) => (Number(o.balance) || 0) > 0).length;
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  const dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
  const deliveriesToday = orders.filter((o) => {
    const d = toDate(o.deliveryDate);
    return d && d >= dayStart && d <= dayEnd;
  }).length;

  setText(
    "dash-alert-strip",
    `🔥 ${deliveriesToday} entregas hoy • ${pendingPayments} pagos pendientes • ${activeOrders.length} clientes esperando`,
  );

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
  const daysInMonth = monthEnd.getDate();
  const daily = Array.from({ length: daysInMonth }, () => 0);
  financeRows.forEach((r) => {
    if (r.type !== "income") return;
    const d = toDate(r.date || r.createdAt);
    if (!d || d < monthStart || d > monthEnd) return;
    daily[d.getDate() - 1] += Number(r.amount) || 0;
  });
  drawSalesChart(document.getElementById("dash-sales-chart"), daily);

  const monthIncome = daily.reduce((a, b) => a + b, 0);
  const monthExpense = financeRows.reduce((sum, r) => {
    if (r.type !== "expense") return sum;
    const d = toDate(r.date || r.createdAt);
    if (!d || d < monthStart || d > monthEnd) return sum;
    return sum + (Number(r.amount) || 0);
  }, 0);
  setText("dash-mini-active", String(activeOrders.length));
  setText("dash-mini-balance", formatUsd(monthIncome - monthExpense));
  setText("dash-mini-clients", String(clients.length));
  setText("dash-mini-campaigns", String(campaigns.activeCount));

  const upcoming = calSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .map((x) => ({ ...x, _d: toDate(x.date) }))
    .filter((x) => x._d && x._d >= dayStart)
    .sort((a, b) => a._d - b._d)
    .slice(0, 5);
  const ul = document.getElementById("dash-upcoming-list");
  if (ul) {
    ul.innerHTML = "";
    if (!upcoming.length) {
      const li = document.createElement("li");
      li.className = "dash-table-muted";
      li.textContent = "No tienes eventos próximos.";
      ul.appendChild(li);
    } else {
      upcoming.forEach((e) => {
        const li = document.createElement("li");
        li.textContent = `• ${formatShortDate(e._d)} - ${e.title || "Evento"}`;
        ul.appendChild(li);
      });
    }
  }
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
    });
  });
}

boot();

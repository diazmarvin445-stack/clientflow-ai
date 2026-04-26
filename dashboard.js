import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  resolveBusinessForUser,
  formatBusinessMeta,
  initialsFromName,
  financeIncomeCountsTowardRealized,
} from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";
import { businessCollectionRef } from "./category-context.js";

/** @type {(() => void) | null} */
let unsubscribeDashboard = null;

/**
 * @param {unknown} v
 * @returns {Date | null}
 */
function toDate(v) {
  if (v == null) return null;
  if (typeof v === "object" && v !== null && typeof /** @type {{ toDate?: () => Date }} */ (v).toDate === "function") {
    try {
      const d = /** @type {{ toDate: () => Date }} */ (v).toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(/** @type {string | number} */ (v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {{ id: string, data: Record<string, unknown> } | null} business
 * @param {Record<string, unknown>[]} orders
 * @param {Record<string, unknown>[]} clients
 * @param {Record<string, unknown>[]} financeRows
 * @param {Record<string, unknown>[]} calendarRows
 * @param {Record<string, unknown>[]} campaignRows
 */
/**
 * @param {{ id: string, data: Record<string, unknown> }} business
 * @param {Record<string, unknown>[]} orders
 * @param {Record<string, unknown>[]} clients
 * @param {Record<string, unknown>[]} financeRows
 * @param {Record<string, unknown>[]} calendarRows
 * @param {Record<string, unknown>[]} campaignRows
 */
function renderDashboardSnapshot(
  business,
  orders,
  clients,
  financeRows,
  calendarRows,
  campaignRows,
) {
  renderHeader(business);
  renderGreeting();

  if (!business) {
    return;
  }

  const cat = String(business?.data?.businessCategory || business?.data?.category || "")
    .trim()
    .toLowerCase();
  const isConstruction = cat === "construction";
  const activeOrders = orders.filter((o) =>
    isConstruction
      ? ["pending", "in_progress"].includes(String(o.status || "").toLowerCase())
      : !["entregado", "cancelado"].includes(String(o.status || "").toLowerCase()),
  );
  const pendingPayments = orders.filter((o) => {
    if (isConstruction) {
      const st = String(o.status || "").toLowerCase();
      const unpaid = st !== "paid";
      const bal = Math.max(0, (Number(o.totalCharged) || 0) - (Number(o.paidAmount) || 0));
      return (st === "completed" || st === "in_progress") && (unpaid || bal > 0);
    }
    return (Number(o.balance) || 0) > 0;
  }).length;
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  const dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
  const deliveriesToday = orders.filter((o) => {
    const d = toDate(isConstruction ? o.startDate : o.deliveryDate);
    return d && d >= dayStart && d <= dayEnd;
  }).length;

  if (isConstruction) {
    const delayed = orders.filter((o) => {
      const eta = toDate(o.estimatedEndDate);
      const st = String(o.status || "").toLowerCase();
      return eta && eta < dayStart && !["completed", "paid"].includes(st);
    }).length;
    const pendingMaterials = orders.filter((o) => {
      const mats = Array.isArray(o.materialsUsed) ? o.materialsUsed.length : 0;
      const st = String(o.status || "").toLowerCase();
      return st === "in_progress" && mats === 0;
    }).length;
    setText(
      "dash-alert-strip",
      `⚠️ ${delayed} trabajos retrasados • ${pendingMaterials} materiales pendientes • ${pendingPayments} trabajos sin pago`,
    );
  } else {
    setText(
      "dash-alert-strip",
      `🔥 ${deliveriesToday} entregas hoy • ${pendingPayments} pagos pendientes • ${activeOrders.length} pedidos activos`,
    );
  }

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
  const daysInMonth = monthEnd.getDate();
  const daily = Array.from({ length: daysInMonth }, () => 0);
  financeRows.forEach((r) => {
    if (r.type !== "income") return;
    if (!financeIncomeCountsTowardRealized(r)) return;
    const d = toDate(r.date || r.createdAt);
    if (!d || d < monthStart || d > monthEnd) return;
    daily[d.getDate() - 1] += Number(r.amount) || 0;
  });
  drawSalesChart(document.getElementById("dash-sales-chart"), daily);

  const monthIncome = daily.reduce((a, b) => a + b, 0);
  const monthExpenseVariables = financeRows.reduce((sum, r) => {
    if (r.type !== "expense") return sum;
    const d = toDate(r.date || r.createdAt);
    if (!d || d < monthStart || d > monthEnd) return sum;
    return sum + (Number(r.amount) || 0);
  }, 0);
  const monthExpense = monthExpenseVariables;

  setText("dash-mini-active", String(activeOrders.length));
  if (isConstruction) {
    const completed = orders.filter((o) => ["completed", "paid"].includes(String(o.status || "").toLowerCase())).length;
    const upcoming = orders.filter((o) => {
      const d = toDate(o.startDate || o.estimatedEndDate);
      return d && d >= dayStart;
    }).length;
    setText("dash-mini-completed", String(completed));
    setText("dash-mini-upcoming", String(upcoming));
    setText("dash-mini-revenue", formatUsd(monthIncome));
    setText("dash-mini-expenses", formatUsd(monthExpense));
    setText("dash-mini-profit", formatUsd(monthIncome - monthExpense));
  } else {
    setText("dash-mini-completed", String(orders.filter((o) => ["entregado"].includes(String(o.status || "").toLowerCase())).length));
    setText("dash-mini-upcoming", String(deliveriesToday));
    setText("dash-mini-revenue", formatUsd(monthIncome));
    setText("dash-mini-expenses", formatUsd(monthExpense));
    setText("dash-mini-profit", formatUsd(monthIncome - monthExpense));
  }

  const upcoming = calendarRows
    .map((x) => ({ ...x, _d: toDate(x.date) }))
    .filter((x) => x._d && x._d >= dayStart)
    .sort((a, b) => /** @type {number} */ (a._d?.getTime()) - /** @type {number} */ (b._d?.getTime()))
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
  if (unsubscribeDashboard) {
    unsubscribeDashboard();
    unsubscribeDashboard = null;
  }

  const business = await resolveBusinessForUser(db, user);

  if (!business) {
    renderHeader(null);
    renderGreeting();
    return;
  }

  const bid = business.id;
  const scopeUid = business?.scope?.uid || user.uid;
  const scopeCategory = "yourcolor";
  const cat = String(business?.data?.businessCategory || business?.data?.category || "")
    .trim()
    .toLowerCase();
  const jobsCollection = cat === "construction" ? "jobs" : "orders";
  /** @type {{ orders: Record<string, unknown>[]; clients: Record<string, unknown>[]; finance: Record<string, unknown>[]; calendar: Record<string, unknown>[]; campaigns: Record<string, unknown>[] }} */
  const state = {
    orders: [],
    clients: [],
    finance: [],
    calendar: [],
    campaigns: [],
  };

  const rerender = () => {
    renderDashboardSnapshot(
      business,
      state.orders,
      state.clients,
      state.finance,
      state.calendar,
      state.campaigns,
    );
  };

  const unsubs = [];
  unsubs.push(
    onSnapshot(
      query(
        businessCollectionRef(db, scopeUid, scopeCategory, jobsCollection),
        orderBy("createdAt", "desc"),
        limit(400),
      ),
      (snap) => {
        state.orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rerender();
      },
      (err) => console.error("[dashboard] orders", err),
    ),
  );

  unsubs.push(
    onSnapshot(
      businessCollectionRef(db, scopeUid, scopeCategory, "clients"),
      (snap) => {
        state.clients = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rerender();
      },
      (err) => console.error("[dashboard] clients", err),
    ),
  );

  unsubs.push(
    onSnapshot(
      query(
        businessCollectionRef(db, scopeUid, scopeCategory, "finances"),
        orderBy("date", "desc"),
        limit(500),
      ),
      (snap) => {
        state.finance = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rerender();
      },
      (err) => console.error("[dashboard] finance", err),
    ),
  );

  unsubs.push(
    onSnapshot(
      query(
        businessCollectionRef(db, scopeUid, scopeCategory, "calendar"),
        orderBy("date", "desc"),
        limit(200),
      ),
      (snap) => {
        state.calendar = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rerender();
      },
      (err) => console.error("[dashboard] calendar", err),
    ),
  );

  unsubs.push(
    onSnapshot(
      businessCollectionRef(db, scopeUid, scopeCategory, "campaigns"),
      (snap) => {
        state.campaigns = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rerender();
      },
      (err) => console.error("[dashboard] campaigns", err),
    ),
  );

  unsubscribeDashboard = () => {
    unsubs.forEach((fn) => fn());
  };
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

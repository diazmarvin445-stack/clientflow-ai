import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { resolveBusinessForUser, formatBusinessMeta, initialsFromName } from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";

const CREATE_MANUAL_ORDER_URL = "https://us-central1-clientflow-ai-7eb08.cloudfunctions.net/createManualOrder";
const UPDATE_ORDER_STATUS_URL = "https://us-central1-clientflow-ai-7eb08.cloudfunctions.net/updateOrderStatus";
const UPDATE_ORDER_AND_SYNC_URL = "https://us-central1-clientflow-ai-7eb08.cloudfunctions.net/updateOrderAndSync";
const DELETE_ORDER_CASCADE_URL = "https://us-central1-clientflow-ai-7eb08.cloudfunctions.net/deleteOrderCascade";

let activeBusinessId = "";
let allOrders = [];
let ordersUnsub = null;
let selectedOrderId = null;

function money(v) {
  const n = Number(v) || 0;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseOrderDeliveredDate(v) {
  const d = toDate(v);
  if (d) return d;
  return new Date();
}

function getOrderTotal(row) {
  return Math.max(0, Number(row?.total ?? row?.amount) || 0);
}

function formatOrderFinanceCell(row) {
  const total = getOrderTotal(row);
  const expenses = Math.max(0, Number(row?.expenses) || 0);
  const profit = total - expenses;
  const delivered = String(row?.status || "").toLowerCase() === "entregado";
  const dep = Math.max(0, Number(row?.deposit) || 0);
  const bal = Math.max(0, Number(row?.balance) || 0);
  /** @type {string[]} */
  const lines = [];
  lines.push(`Total: ${money(total)}`);
  lines.push(`Gastos: -${money(expenses).replace("$", "$")}`);
  lines.push(delivered ? `Ganancia neta: ${money(profit)} 🟢` : `Ganancia proy: ${money(profit)} 🟡`);
  if (dep > 0) lines.push(`Depósito/Saldo: ${money(dep)} / ${money(bal)}`);
  return lines.join("<br>");
}

function renderHeader(business) {
  const nameEl = document.getElementById("dash-business-name");
  const metaEl = document.getElementById("dash-business-meta");
  const av = document.getElementById("dash-avatar-initials");
  if (!business) return;
  const displayName = (typeof business.data.businessName === "string" && business.data.businessName.trim()) || "Tu negocio";
  const { metaLine } = formatBusinessMeta(business.data);
  if (nameEl) nameEl.textContent = displayName;
  if (metaEl) metaEl.textContent = metaLine;
  if (av) av.textContent = initialsFromName(displayName);
}

function statusBadgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "entregado") return "dash-badge--done";
  if (s === "produccion") return "dash-badge--sched";
  if (s === "cancelado") return "dash-badge--cancelled";
  return "dash-badge--prog";
}

function sourceLabel(source) {
  if (source === "whatsapp") return "💬 WhatsApp";
  if (source === "chat_interno") return "🤖 Chat";
  return "✍️ Manual";
}

function weekBounds() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const start = new Date(now);
  start.setDate(now.getDate() - day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function monthBounds() {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
  };
}

function renderSummary(rows) {
  const active = rows.filter((r) => !["entregado", "cancelado"].includes(String(r.status || "").toLowerCase())).length;
  const wb = weekBounds();
  const weekPending = rows.filter((r) => {
    const d = toDate(r.deliveryDate);
    const s = String(r.status || "").toLowerCase();
    return d && d >= wb.start && d <= wb.end && !["entregado", "cancelado"].includes(s);
  }).length;
  const mb = monthBounds();
  const monthTotal = rows.reduce((sum, r) => {
    const d = toDate(r.createdAt);
    if (!d || d < mb.start || d > mb.end) return sum;
    return sum + getOrderTotal(r);
  }, 0);
  const balance = rows.reduce((sum, r) => sum + (Number(r.balance) || 0), 0);

  document.getElementById("orders-metric-active").textContent = String(active);
  document.getElementById("orders-metric-week").textContent = String(weekPending);
  document.getElementById("orders-metric-month").textContent = money(monthTotal);
  document.getElementById("orders-metric-balance").textContent = money(balance);
}

function getFilters() {
  return {
    status: document.getElementById("orders-filter-status").value,
    date: document.getElementById("orders-filter-date").value,
    source: document.getElementById("orders-filter-source").value,
    search: document.getElementById("orders-filter-search").value.trim().toLowerCase(),
  };
}

function applyFilters(rows) {
  const f = getFilters();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const wb = weekBounds();
  const mb = monthBounds();
  return rows.filter((r) => {
    const st = String(r.status || "").toLowerCase();
    if (f.status !== "all" && st !== f.status) return false;
    const src = String(r.source || "manual");
    if (f.source !== "all" && src !== f.source) return false;
    const text = `${r.clientName || ""} ${r.clientPhone || ""}`.toLowerCase();
    if (f.search && !text.includes(f.search)) return false;
    if (f.date !== "all") {
      const d = toDate(r.createdAt);
      if (!d) return false;
      if (f.date === "today" && (d < todayStart || d > todayEnd)) return false;
      if (f.date === "week" && (d < wb.start || d > wb.end)) return false;
      if (f.date === "month" && (d < mb.start || d > mb.end)) return false;
    }
    return true;
  });
}

async function deleteOrder(orderId) {
  const ok = window.confirm("¿Eliminar este pedido?");
  if (!ok) return;
  await fetch(DELETE_ORDER_CASCADE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessId: activeBusinessId, orderId }),
  });
}

async function saveOrderFromModal(ev) {
  ev.preventDefault();
  const orderId = document.getElementById("orders-order-id").value.trim();
  const payload = {
    businessId: activeBusinessId,
    clientName: document.getElementById("orders-client-name").value.trim(),
    clientPhone: document.getElementById("orders-client-phone").value.trim(),
    product: document.getElementById("orders-product").value.trim(),
    quantity: Number(document.getElementById("orders-quantity").value || 0),
    amount: Number(document.getElementById("orders-amount").value || 0),
    total: Number(document.getElementById("orders-amount").value || 0),
    deposit: Number(document.getElementById("orders-deposit").value || 0),
    expenses: Number(document.getElementById("orders-expenses").value || 0),
    deliveryDate: document.getElementById("orders-delivery-date").value || null,
    notes: document.getElementById("orders-notes").value.trim(),
    status: document.getElementById("orders-status").value,
  };

  if (!orderId) {
    const res = await fetch(CREATE_MANUAL_ORDER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("No se pudo crear el pedido manual.");
  } else {
    await fetch(UPDATE_ORDER_AND_SYNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessId: activeBusinessId,
        orderId,
        ...payload,
      }),
    });
  }
  document.getElementById("orders-modal").close();
}

async function markOrderDelivered(orderId) {
  const res = await fetch(UPDATE_ORDER_STATUS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessId: activeBusinessId, orderId, status: "entregado" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof body?.error === "string" ? body.error : "No se pudo marcar como entregado.";
    throw new Error(msg);
  }
  console.log("[MARK_DELIVERED]", { orderId, ok: true });
}

async function repairDeliveredOrders() {
  if (!activeBusinessId) throw new Error("No hay negocio activo.");
  const ok = window.confirm(
    "Esto creará movimientos faltantes en Finanzas para pedidos entregados. ¿Continuar?",
  );
  if (!ok) return;

  const ordersRef = collection(db, "businesses", activeBusinessId, "orders");
  const financeRef = collection(db, "businesses", activeBusinessId, "finance");
  const allOrdersSnap = await getDocs(ordersRef);
  const orderById = new Map();
  allOrdersSnap.forEach((d) => {
    orderById.set(d.id, d.data() || {});
  });

  let removed = 0;
  const financeSnap = await getDocs(financeRef);
  for (const fd of financeSnap.docs) {
    const mov = fd.data() || {};
    const orderId = typeof mov.orderId === "string" ? mov.orderId : "";
    if (!orderId) continue;
    const o = orderById.get(orderId);
    if (!o) continue;
    const st = String(o.status || "").toLowerCase();
    const type = String(mov.type || "").toLowerCase();
    if (st !== "entregado" && (type === "income" || type === "expense")) {
      await deleteDoc(fd.ref);
      removed += 1;
    }
  }

  const deliveredSnap = await getDocs(query(ordersRef, where("status", "==", "entregado")));

  let repaired = 0;
  for (const d of deliveredSnap.docs) {
    const order = d.data() || {};
    const orderId = d.id;
    const clientName = String(order.clientName || "Cliente");
    const product = String(order.product || "Pedido");
    const totalPaid = Math.max(0, Number(order.totalPaid ?? order.total ?? order.amount) || 0);
    const expenses = Math.max(0, Number(order.expenses) || 0);
    const deliveredDate = parseOrderDeliveredDate(order.deliveredAt);

    const incomeExisting = await getDocs(
      query(financeRef, where("orderId", "==", orderId), where("type", "==", "income")),
    );
    const expenseExisting = await getDocs(
      query(financeRef, where("orderId", "==", orderId), where("type", "==", "expense")),
    );

    if (incomeExisting.empty && totalPaid > 0) {
      await addDoc(financeRef, {
        type: "income",
        amount: totalPaid,
        description: `Cobro total pedido entregado: ${product} - ${clientName}`,
        orderId,
        linkedOrderId: orderId,
        clientName,
        date: Timestamp.fromDate(deliveredDate),
        category: "ventas",
        status: "cobrado",
        createdBy: "marvin",
        createdAt: serverTimestamp(),
      });
      repaired += 1;
    }

    if (expenseExisting.empty && expenses > 0) {
      await addDoc(financeRef, {
        type: "expense",
        amount: expenses,
        description: `Gastos materiales: ${product} - ${clientName}`,
        orderId,
        linkedOrderId: orderId,
        clientName,
        date: Timestamp.fromDate(deliveredDate),
        category: "materiales",
        status: "cobrado",
        createdBy: "marvin",
        createdAt: serverTimestamp(),
      });
      repaired += 1;
    }
  }

  alert(`Reparación completada. Movimientos creados: ${repaired}. Movimientos incorrectos borrados: ${removed}.`);
}

function fillDetail(row) {
  document.getElementById("od-client").textContent = row.clientName || "—";
  document.getElementById("od-phone").textContent = row.clientPhone || "—";
  document.getElementById("od-product").textContent = row.product || "—";
  document.getElementById("od-qty").textContent = String(row.quantity ?? "—");
  const total = getOrderTotal(row);
  document.getElementById("od-amount").textContent = money(total);
  document.getElementById("od-deposit").textContent = money(row.deposit);
  document.getElementById("od-balance").textContent = money(row.balance);
  const exp = Number(row.expenses) || 0;
  const expEl = document.getElementById("od-expenses");
  if (expEl && "value" in expEl) expEl.value = String(exp);
  const expDisp = document.getElementById("od-expenses-display");
  if (expDisp) expDisp.textContent = money(exp);
  const amt = total;
  const netProfit = Math.max(0, amt - exp);
  const stRaw = String(row.status || "nuevo").toLowerCase();
  const delivered = stRaw === "entregado";
  const statusLabels = {
    entregado: "Entregado",
    cancelado: "Cancelado",
    nuevo: "Nuevo",
    produccion: "Producción",
    listo: "Listo",
  };
  const npEl = document.getElementById("od-net-profit");
  if (npEl) {
    npEl.textContent = delivered ? money(row.netProfit != null ? row.netProfit : netProfit) : "—";
  }
  document.getElementById("od-status").textContent = statusLabels[stRaw] || "Pendiente";
  document.getElementById("od-delivery").textContent = toDate(row.deliveryDate)?.toLocaleDateString("es") || "—";
  document.getElementById("od-source").textContent = sourceLabel(row.source);
  document.getElementById("od-notes").textContent = row.notes || "—";
  const btnDel = document.getElementById("od-mark-delivered");
  if (btnDel) btnDel.disabled = delivered;
}

function openModalFor(row = null) {
  const modal = document.getElementById("orders-modal");
  document.getElementById("orders-modal-title").textContent = row ? "Editar pedido" : "Nuevo pedido manual";
  document.getElementById("orders-order-id").value = row?.id || "";
  document.getElementById("orders-client-name").value = row?.clientName || "";
  document.getElementById("orders-client-phone").value = row?.clientPhone || "";
  document.getElementById("orders-product").value = row?.product || "";
  document.getElementById("orders-quantity").value = row?.quantity ?? "";
  document.getElementById("orders-amount").value = row?.amount ?? "";
  document.getElementById("orders-deposit").value = row?.deposit ?? "";
  document.getElementById("orders-expenses").value = row?.expenses ?? "0";
  const dd = toDate(row?.deliveryDate);
  document.getElementById("orders-delivery-date").value = dd ? dd.toISOString().slice(0, 10) : "";
  document.getElementById("orders-notes").value = row?.notes || "";
  document.getElementById("orders-status").value = row?.status || "nuevo";
  modal.showModal();
}

function renderRows() {
  const tbody = document.getElementById("orders-tbody");
  const mobileRoot = document.getElementById("orders-mobile-list");
  const rows = applyFilters(allOrders);
  tbody.innerHTML = "";
  if (mobileRoot) mobileRoot.innerHTML = "";
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 9;
    td.className = "dash-table-muted";
    td.textContent = "No hay pedidos para este filtro.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    if (mobileRoot) {
      mobileRoot.hidden = false;
      const empty = document.createElement("p");
      empty.className = "dash-table-muted";
      empty.textContent = "No hay pedidos para este filtro.";
      mobileRoot.appendChild(empty);
    }
    return;
  }
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const dateLabel = toDate(row.deliveryDate)?.toLocaleDateString("es") || "—";
    const isDelivered = String(row.status || "").toLowerCase() === "entregado";
    tr.innerHTML = `
      <td><input type="checkbox" aria-label="Seleccionar pedido" /></td>
      <td><strong>${row.clientName || "—"}</strong><br><span class="dash-table-muted">${row.clientPhone || "—"}</span></td>
      <td>${row.product || "—"}</td>
      <td>${formatOrderFinanceCell(row)}</td>
      <td><span class="dash-badge ${statusBadgeClass(row.status)}">${row.status || "nuevo"}</span></td>
      <td>${sourceLabel(row.source)}</td>
      <td>${dateLabel}</td>
      <td>${row.notes || "—"}</td>
      <td>
        <button class="dash-icon-btn" data-edit="${row.id}" title="Editar pedido">✏️</button>
        <button
          class="dash-icon-btn"
          data-quick-deliver="${row.id}"
          title="Marcar como entregado y cobrado"
          ${isDelivered ? "disabled aria-disabled='true'" : ""}
        >✅</button>
        <button class="dash-icon-btn" data-del="${row.id}" title="Eliminar pedido">🗑️</button>
      </td>
    `;
    tr.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      selectedOrderId = row.id;
      fillDetail(row);
      document.getElementById("orders-detail-panel").hidden = false;
    });
    tbody.appendChild(tr);

    if (mobileRoot) {
      const total = getOrderTotal(row);
      const expenses = Math.max(0, Number(row?.expenses) || 0);
      const profit = total - expenses;
      const delivered = String(row.status || "").toLowerCase() === "entregado";
      const dateLabel = toDate(row.deliveryDate)?.toLocaleDateString("es") || "—";

      const card = document.createElement("article");
      card.className = "orders-mobile-card";
      card.innerHTML = `
        <div class="orders-mobile-card__head">
          <p class="orders-mobile-card__client">${row.clientName || "—"}</p>
          <span class="dash-badge ${statusBadgeClass(row.status)}">${row.status || "nuevo"}</span>
        </div>
        <p class="orders-mobile-card__product">${row.product || "—"}</p>
        <div class="orders-mobile-card__finance">
          <span>Total: ${money(total)}</span>
          <span>Gastos: ${money(expenses)}</span>
          <span>${delivered ? "Ganancia neta" : "Ganancia proy"}: ${money(profit)}</span>
        </div>
        <div class="orders-mobile-card__meta">
          <span>Entrega: ${dateLabel}</span>
          <span>${sourceLabel(row.source)}</span>
        </div>
        <div class="orders-mobile-card__actions">
          <button class="dash-quick-btn" data-edit="${row.id}">Editar</button>
          <button class="dash-quick-btn" data-quick-deliver="${row.id}" ${delivered ? "disabled aria-disabled='true'" : ""}>
            Entregar
          </button>
          <button class="dash-quick-btn" data-del="${row.id}">Eliminar</button>
        </div>
      `;
      card.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        selectedOrderId = row.id;
        fillDetail(row);
        document.getElementById("orders-detail-panel").hidden = false;
      });
      mobileRoot.appendChild(card);
    }
  });

  tbody.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = allOrders.find((x) => x.id === btn.getAttribute("data-edit"));
      if (row) openModalFor(row);
    });
  });
  tbody.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await deleteOrder(btn.getAttribute("data-del"));
    });
  });
  tbody.querySelectorAll("[data-quick-deliver]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const orderId = btn.getAttribute("data-quick-deliver");
      if (!orderId) return;
      const ok = window.confirm("¿Marcar este pedido como entregado y cobrado?");
      if (!ok) return;
      await markOrderDelivered(orderId);
    });
  });

  if (mobileRoot) {
    mobileRoot.hidden = false;
    mobileRoot.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = allOrders.find((x) => x.id === btn.getAttribute("data-edit"));
        if (row) openModalFor(row);
      });
    });
    mobileRoot.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await deleteOrder(btn.getAttribute("data-del"));
      });
    });
    mobileRoot.querySelectorAll("[data-quick-deliver]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const orderId = btn.getAttribute("data-quick-deliver");
        if (!orderId) return;
        const ok = window.confirm("¿Marcar este pedido como entregado y cobrado?");
        if (!ok) return;
        await markOrderDelivered(orderId);
      });
    });
  }
}

function wireUi() {
  document.getElementById("orders-btn-add").addEventListener("click", () => openModalFor(null));
  document.getElementById("orders-btn-cancel").addEventListener("click", () => document.getElementById("orders-modal").close());
  document.getElementById("orders-form").addEventListener("submit", (ev) => {
    saveOrderFromModal(ev).catch((e) => window.alert(e instanceof Error ? e.message : "Error al guardar pedido"));
  });
  ["orders-filter-status", "orders-filter-date", "orders-filter-source", "orders-filter-search"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderRows);
    document.getElementById(id).addEventListener("change", renderRows);
  });
  document.getElementById("orders-detail-close").addEventListener("click", () => {
    document.getElementById("orders-detail-panel").hidden = true;
  });
  document.getElementById("od-edit").addEventListener("click", () => {
    const row = allOrders.find((x) => x.id === selectedOrderId);
    if (row) openModalFor(row);
  });
  document.getElementById("od-mark-delivered").addEventListener("click", async () => {
    if (!selectedOrderId) return;
    await markOrderDelivered(selectedOrderId);
  });
  const saveExp = document.getElementById("od-save-expenses");
  if (saveExp) {
    saveExp.addEventListener("click", async () => {
      if (!selectedOrderId) return;
      const input = document.getElementById("od-expenses");
      const expenses = input && "value" in input ? Number(input.value) || 0 : 0;
      await fetch(UPDATE_ORDER_AND_SYNC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: activeBusinessId,
          orderId: selectedOrderId,
          expenses,
        }),
      });
    });
  }
  document.getElementById("od-delete").addEventListener("click", async () => {
    if (!selectedOrderId) return;
    await deleteOrder(selectedOrderId);
    document.getElementById("orders-detail-panel").hidden = true;
  });
  const repairBtn = document.getElementById("orders-btn-repair");
  if (repairBtn) {
    repairBtn.addEventListener("click", () => {
      repairDeliveredOrders().catch((e) => {
        console.error("[REPAIR_DELIVERED_ORDERS]", e);
        alert(e instanceof Error ? e.message : "No se pudo reparar pedidos entregados.");
      });
    });
  }
}

function subscribeOrders() {
  if (ordersUnsub) ordersUnsub();
  const q = query(collection(db, "businesses", activeBusinessId, "orders"), orderBy("createdAt", "desc"));
  ordersUnsub = onSnapshot(q, (snap) => {
    allOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderSummary(allOrders);
    renderRows();
  });
}

function boot() {
  initDashShell({ auth, db });
  wireUi();
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    const business = await resolveBusinessForUser(db, user);
    if (!business) return;
    activeBusinessId = business.id;
    renderHeader(business);
    subscribeOrders();
  });
}

boot();

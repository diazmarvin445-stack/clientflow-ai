import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  resolveBusinessForUser,
  fetchTeamMembersForBusiness,
  formatBusinessMeta,
  initialsFromName,
} from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";
import { businessCollectionRef, businessDocRef } from "./category-context.js";

/** @type {string | null} */
let businessId = null;
/** @type {string | null} */
let scopeUid = null;
/** @type {Record<string, unknown>[]} */
let members = [];
/** @type {import("https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js").User | null} */
let currentUser = null;
/** @type {Record<string, unknown>[]} */
let teamSessions = [];
/** @type {(() => void) | null} */
let unsubSessions = null;
/** @type {(() => void) | null} */
let unsubPendingOrders = null;
/** @type {Record<string, unknown>[]} */
let pendingOrders = [];

function scopedCollection(subcollection) {
  if (!businessId) return null;
  const scopedName = subcollection === "finance" ? "finances" : subcollection;
  if (scopeUid) return businessCollectionRef(db, scopeUid, businessId, scopedName);
  return collection(db, "businesses", businessId, subcollection);
}

function scopedDoc(subcollection, id) {
  if (!businessId || !id) return null;
  const scopedName = subcollection === "finance" ? "finances" : subcollection;
  if (scopeUid) return businessDocRef(db, scopeUid, businessId, scopedName, String(id));
  return doc(db, "businesses", businessId, subcollection, String(id));
}

/**
 * Simple client session clock + Firestore session id.
 * sessionStatus: sin_sesion | activa | pausada | finalizada
 * orderStatus: sin_iniciar | en_preparacion | listo (work / prep state)
 */
let currentWorkSession = {
  firestoreSessionId: null,
  orderId: null,
  orderStatus: "sin_iniciar",
  sessionStatus: "sin_sesion",
  hourlyRate: 0,
  startedAt: null,
  accumulatedMs: 0,
  clientName: null,
  product: null,
};

/** @type {ReturnType<typeof setInterval> | null} */
let workTimerInterval = null;

const DEFAULT_HOURLY_RATE_USD = 15;

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_SHORT_ES = {
  mon: "Lun",
  tue: "Mar",
  wed: "Mié",
  thu: "Jue",
  fri: "Vie",
  sat: "Sáb",
  sun: "Dom",
};

function defaultHourlyRateStorageKey(bid) {
  return `cf_team_default_hourly_rate_v1_${bid}`;
}

function getDefaultHourlyRate() {
  if (!businessId) return DEFAULT_HOURLY_RATE_USD;
  const stored = Number(localStorage.getItem(defaultHourlyRateStorageKey(businessId)));
  if (Number.isFinite(stored) && stored > 0) return stored;
  return DEFAULT_HOURLY_RATE_USD;
}

function saveWorkHourlyRateToStorage(rate) {
  if (!businessId) return;
  if (Number.isFinite(rate) && rate > 0) {
    localStorage.setItem(defaultHourlyRateStorageKey(businessId), String(rate));
  }
}

function memberHourlyRate(m) {
  const raw = Number(m.hourlyRate);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return getDefaultHourlyRate();
}

function getWorkHourlyRateFromInput() {
  const el = document.getElementById("eq-work-hourly-rate");
  const n = el && "value" in el ? Number(el.value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return n;
}

function prefillWorkHourlyRate() {
  const el = document.getElementById("eq-work-hourly-rate");
  if (!(el instanceof HTMLInputElement)) return;
  const m = memberForCurrentUser();
  const r = m ? memberHourlyRate(m) : getDefaultHourlyRate();
  el.value = String(r);
}

function formatMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0.00";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDurationMs(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function sameDay(d, ref = new Date()) {
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

function tsToDate(ts) {
  if (!ts || typeof ts !== "object") return null;
  if (typeof /** @type {{ toDate?: () => Date }} */ (ts).toDate === "function") {
    try {
      const d = /** @type {{ toDate: () => Date }} */ (ts).toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  return null;
}

function tsToMillis(ts) {
  const d = tsToDate(ts);
  return d ? d.getTime() : 0;
}

function isPendingOrderStatus(raw) {
  const s = String(raw || "").toLowerCase();
  return s === "nuevo" || s === "produccion" || s === "en_preparacion" || s === "listo";
}

function formatOrderPickerOptionLabel(order) {
  const clientName = String(order.clientName || "Cliente");
  const product = String(order.product || "Pedido");
  const total = Number(order.total ?? order.amount) || 0;
  const status = String(order.status || "nuevo");
  const delivery = tsToDate(order.deliveryDate);
  const deliveryLabel = delivery ? delivery.toLocaleDateString("es") : "sin fecha";
  return `${clientName} · ${product} · ${formatMoney(total)} · ${status} · ${deliveryLabel}`;
}

function selectedLinkedOrder() {
  const picker = document.getElementById("eq-linked-order-picker");
  const selectedId = picker && "value" in picker ? String(picker.value || "").trim() : "";
  if (!selectedId) return null;
  return pendingOrders.find((o) => String(o.id || "") === selectedId) || null;
}

function normalizeSessionStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (s === "active" || s === "activa") return "activa";
  if (s === "paused" || s === "pausada") return "pausada";
  if (s === "completed" || s === "finalizada") return "finalizada";
  return "sin_sesion";
}

function renderLinkedOrderSummary() {
  const summary = document.getElementById("eq-linked-order-summary");
  if (!summary) return;
  const selected = selectedLinkedOrder();
  if (!selected) {
    summary.textContent = "Selecciona un pedido pendiente.";
    return;
  }
  const clientName = String(selected.clientName || "Cliente");
  const product = String(selected.product || "Pedido");
  const status = String(selected.status || "nuevo");
  const total = Number(selected.total ?? selected.amount) || 0;
  const delivery = tsToDate(selected.deliveryDate);
  summary.textContent = `${clientName} · ${product} · ${formatMoney(total)} · ${status}${delivery ? ` · ${delivery.toLocaleDateString("es")}` : ""}`;
}

function renderPendingOrdersPicker() {
  const picker = document.getElementById("eq-linked-order-picker");
  if (!(picker instanceof HTMLSelectElement)) return;
  const selectedBefore = String(picker.value || "");
  picker.innerHTML = "";

  const noneOp = document.createElement("option");
  noneOp.value = "";
  noneOp.textContent = "— Elegir pedido —";
  picker.appendChild(noneOp);

  for (const order of pendingOrders) {
    const op = document.createElement("option");
    op.value = String(order.id || "");
    op.textContent = formatOrderPickerOptionLabel(order);
    picker.appendChild(op);
  }

  if (selectedBefore && pendingOrders.some((o) => String(o.id || "") === selectedBefore)) {
    picker.value = selectedBefore;
  } else {
    picker.value = "";
  }
  renderLinkedOrderSummary();
}

function todayCode() {
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[new Date().getDay()];
}

function renderHeader(business) {
  const nameEl = document.getElementById("dash-business-name");
  const metaEl = document.getElementById("dash-business-meta");
  const av = document.getElementById("dash-avatar-initials");

  if (!business) {
    if (nameEl) nameEl.textContent = "Equipo";
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

function showLoadError(msg) {
  const el = document.getElementById("eq-load-error");
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

/** @param {unknown} err */
function handleEquipoFirestorePermissionDenied(context, err) {
  const code =
    err && typeof err === "object" && err !== null && "code" in err
      ? String(/** @type {{ code?: string }} */ (err).code || "")
      : "";
  const msg = err instanceof Error ? err.message : String(err || "");
  if (
    code === "permission-denied" ||
    /missing or insufficient permissions|insufficient permissions|permission-denied/i.test(msg)
  ) {
    console.error(`[Equipo] Firestore permission denied (${context}):`, code, msg);
    showLoadError("Permiso denegado en Firestore para control de jornada");
    return true;
  }
  return false;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function telHref(phone) {
  const s = typeof phone === "string" ? phone.trim() : "";
  if (!s) return null;
  const cleaned = s.replace(/[^\d+]/g, "");
  return cleaned ? `tel:${cleaned}` : null;
}

function normalizeWorkDays(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((d) => typeof d === "string" && DAY_ORDER.includes(d));
}

function normalizeCategory(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s === "administrativo" || s === "operativo") return s;
  return "operativo";
}

function formatDaysLabel(days) {
  const list = normalizeWorkDays(days);
  if (!list.length) return "—";
  const ordered = DAY_ORDER.filter((d) => list.includes(d));
  return ordered.map((d) => DAY_SHORT_ES[d] || d).join(" · ");
}

function formatTimeRange(from, to) {
  const a = typeof from === "string" ? from.trim() : "";
  const b = typeof to === "string" ? to.trim() : "";
  if (!a && !b) return "—";
  if (a && b) return `${a} – ${b}`;
  return a || b;
}

function isActiveToday(m) {
  const active = m.active !== false;
  if (!active) return false;
  const days = normalizeWorkDays(m.workDays);
  if (!days.length) return false;
  return days.includes(todayCode());
}

function computeStats(list) {
  let activeToday = 0;
  let operativo = 0;
  let admin = 0;
  for (const m of list) {
    if (isActiveToday(m)) activeToday += 1;
    const cat = normalizeCategory(m.staffCategory);
    if (cat === "administrativo") admin += 1;
    else operativo += 1;
  }
  return {
    total: list.length,
    activeToday,
    operativo,
    admin,
  };
}

function setPanelMeta(count) {
  const el = document.getElementById("eq-panel-meta");
  if (!el) return;
  if (count === 0) {
    el.textContent = "Cuando agregues personas aparecerán aquí con su información.";
    return;
  }
  el.textContent = `${count} ${count === 1 ? "persona en el equipo" : "personas en el equipo"}`;
}

function renderEmpty(root) {
  root.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "eq-empty";
  wrap.innerHTML =
    '<div class="dash-leads-empty-icon" aria-hidden="true"></div>' +
    '<p class="dash-leads-empty-title">Aún no tienes miembros en tu equipo.</p>' +
    '<p class="dash-leads-empty-text">Agrega empleados o colaboradores para organizar mejor tu operación.</p>';
  root.appendChild(wrap);
}

function renderMemberCard(m) {
  const fullName =
    (typeof m.fullName === "string" && m.fullName.trim()) || "Sin nombre";
  const roleTitle = (typeof m.roleTitle === "string" && m.roleTitle.trim()) || "—";
  const phone = typeof m.phone === "string" ? m.phone.trim() : "";
  const email = typeof m.email === "string" ? m.email.trim() : "";
  const active = m.active !== false;
  const daysStr = formatDaysLabel(m.workDays);
  const hoursStr = formatTimeRange(m.hoursFrom, m.hoursTo);
  const href = telHref(phone);
  const rate = memberHourlyRate(m);

  const card = document.createElement("article");
  card.className = "eq-member-card";
  card.dataset.memberId = m.id;

  const top = document.createElement("div");
  top.className = "eq-member-top";

  const av = document.createElement("div");
  av.className = "eq-member-avatar";
  av.textContent = initialsFromName(fullName);

  const headText = document.createElement("div");
  headText.className = "eq-member-head-text";

  const h = document.createElement("h3");
  h.className = "eq-member-name";
  h.textContent = fullName;

  const role = document.createElement("p");
  role.className = "eq-member-role";
  role.textContent = roleTitle;

  headText.append(h, role);

  const badge = document.createElement("span");
  badge.className = active ? "eq-status eq-status--on" : "eq-status eq-status--off";
  badge.textContent = active ? "Activo" : "Inactivo";

  top.append(av, headText, badge);

  const grid = document.createElement("div");
  grid.className = "eq-meta-grid";

  function row(label, valueEl) {
    const wrap = document.createElement("div");
    wrap.className = "eq-meta-row";
    const lb = document.createElement("span");
    lb.className = "eq-meta-label";
    lb.textContent = label;
    const val = document.createElement("div");
    val.className = "eq-meta-value";
    val.appendChild(valueEl);
    wrap.append(lb, val);
    return wrap;
  }

  const phoneContent = document.createElement("span");
  if (href) {
    const a = document.createElement("a");
    a.href = href;
    a.className = "eq-phone-link";
    a.textContent = phone || "—";
    phoneContent.appendChild(a);
  } else {
    phoneContent.textContent = phone || "—";
  }

  const emailContent = document.createElement("span");
  if (email) {
    const a = document.createElement("a");
    a.href = `mailto:${encodeURIComponent(email)}`;
    a.className = "eq-mail-link";
    a.textContent = email;
    emailContent.appendChild(a);
  } else {
    emailContent.textContent = "—";
  }

  grid.append(
    row("Teléfono", phoneContent),
    row("Correo", emailContent),
    row("Tarifa por hora", document.createTextNode(formatMoney(rate))),
    row("Días asignados", document.createTextNode(daysStr)),
    row("Horario de trabajo", document.createTextNode(hoursStr)),
  );

  const actions = document.createElement("div");
  actions.className = "eq-member-actions";
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "eq-link-btn";
  editBtn.textContent = "Editar";
  editBtn.addEventListener("click", () => openModal(m.id));
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "eq-link-btn eq-link-btn--danger";
  delBtn.textContent = "Eliminar";
  delBtn.addEventListener("click", () => confirmDelete(m.id, fullName));
  actions.append(editBtn, delBtn);

  card.append(top, grid, actions);
  return card;
}

function renderList(list) {
  const root = document.getElementById("eq-members-root");
  if (!root) return;
  root.replaceChildren();

  if (!list.length) {
    renderEmpty(root);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "eq-members-grid";
  for (const m of list) {
    grid.appendChild(renderMemberCard(m));
  }
  root.appendChild(grid);
}

function updateStats(list) {
  const s = computeStats(list);
  setText("eq-stat-total", String(s.total));
  setText("eq-stat-active-today", String(s.activeToday));
  setText("eq-stat-operativo", String(s.operativo));
  setText("eq-stat-admin", String(s.admin));
  setPanelMeta(list.length);
}

// --- Simple work timer engine ---

function elapsedMsNow() {
  if (currentWorkSession.sessionStatus === "activa" && currentWorkSession.startedAt != null) {
    return Math.max(0, currentWorkSession.accumulatedMs + (Date.now() - currentWorkSession.startedAt));
  }
  if (currentWorkSession.sessionStatus === "pausada") {
    return Math.max(0, currentWorkSession.accumulatedMs);
  }
  return 0;
}

function stopWorkTimer() {
  if (workTimerInterval) {
    clearInterval(workTimerInterval);
    workTimerInterval = null;
  }
}

function startWorkTimer() {
  stopWorkTimer();
  workTimerInterval = setInterval(() => {
    if (currentWorkSession.sessionStatus !== "activa") return;
    updateWorkControlUI();
    console.log("timer tick");
  }, 1000);
}

function updateWorkControlUI() {
  const ms = elapsedMsNow();
  const timerEl = document.getElementById("eq-active-timer");
  const payEl = document.getElementById("eq-session-pay-estimate");
  const stateEl = document.getElementById("eq-session-state");
  const orderStateEl = document.getElementById("eq-order-work-state");
  if (timerEl) timerEl.textContent = formatDurationMs(ms);
  if (payEl) {
    const rate = Number(currentWorkSession.hourlyRate) || 0;
    const pay = (ms / (1000 * 60 * 60)) * rate;
    payEl.textContent = formatMoney(pay);
  }
  if (stateEl) stateEl.textContent = currentWorkSession.sessionStatus;
  if (orderStateEl) orderStateEl.textContent = currentWorkSession.orderStatus;
  renderWorkButtons();
}

function resetWorkSessionLocal() {
  stopWorkTimer();
  currentWorkSession = {
    firestoreSessionId: null,
    orderId: null,
    orderStatus: "sin_iniciar",
    sessionStatus: "sin_sesion",
    hourlyRate: 0,
    startedAt: null,
    accumulatedMs: 0,
    clientName: null,
    product: null,
  };
  updateWorkControlUI();
}

/**
 * Map Firestore teamSessions doc into currentWorkSession (open sessions only).
 * @param {Record<string, unknown> | null} s
 */
function syncCurrentWorkFromFirestoreDoc(s) {
  if (!s || typeof s !== "object" || !s.id) {
    resetWorkSessionLocal();
    return;
  }
  const st = normalizeSessionStatus(s.status);
  if (st !== "activa" && st !== "pausada") {
    resetWorkSessionLocal();
    return;
  }
  const orderId = String(s.linkedOrderId || "").trim() || null;
  const hourlyRate = Number(s.hourlyRate);
  const tracked = Math.max(0, Number(s.totalTrackedMs) || 0);
  const base = {
    firestoreSessionId: String(s.id),
    orderId,
    orderStatus: "en_preparacion",
    hourlyRate: Number.isFinite(hourlyRate) && hourlyRate > 0 ? hourlyRate : memberHourlyRate(memberForCurrentUser() || {}),
    clientName: String(s.linkedOrderClientName || "") || null,
    product: String(s.linkedOrderProduct || "") || null,
  };
  if (st === "activa") {
    const resumedAt = tsToDate(s.resumedAt) || tsToDate(s.startedAt) || tsToDate(s.startTime);
    const startedAt = resumedAt ? resumedAt.getTime() : Date.now();
    currentWorkSession = {
      ...base,
      sessionStatus: "activa",
      startedAt,
      accumulatedMs: tracked,
      orderStatus: "en_preparacion",
    };
    startWorkTimer();
  } else {
    currentWorkSession = {
      ...base,
      sessionStatus: "pausada",
      startedAt: null,
      accumulatedMs: tracked,
      orderStatus: "en_preparacion",
    };
    stopWorkTimer();
  }
  updateWorkControlUI();
}

function sessionElapsedMs(session) {
  if (!session || typeof session !== "object") return 0;
  const status = normalizeSessionStatus(session.status);
  const trackedMs = Number(session.totalTrackedMs) || 0;
  if (status !== "activa") return Math.max(0, trackedMs);
  const resumedAt = tsToDate(session.resumedAt) || tsToDate(session.startedAt) || tsToDate(session.startTime);
  if (!resumedAt) return Math.max(0, trackedMs);
  return Math.max(0, trackedMs + (Date.now() - resumedAt.getTime()));
}

function renderWorkButtons() {
  const startBtn = document.getElementById("eq-btn-start");
  const pauseBtn = document.getElementById("eq-btn-pause");
  const resumeBtn = document.getElementById("eq-btn-resume");
  const finishBtn = document.getElementById("eq-btn-finish");
  const ss = currentWorkSession.sessionStatus;
  const hasOpen = ss === "activa" || ss === "pausada";
  const orderSelected = Boolean(selectedLinkedOrder());

  if (startBtn instanceof HTMLButtonElement) {
    startBtn.disabled = ss === "activa" || !orderSelected;
  }
  if (pauseBtn instanceof HTMLButtonElement) {
    pauseBtn.disabled = ss !== "activa";
  }
  if (resumeBtn instanceof HTMLButtonElement) {
    resumeBtn.disabled = ss !== "pausada";
  }
  if (finishBtn instanceof HTMLButtonElement) {
    finishBtn.disabled = !hasOpen;
  }
}

function isUnfinishedOrder(order) {
  const status = String(order?.status || "").toLowerCase();
  const work = String(order?.workStatus || "").toLowerCase();
  if (status === "entregado" || status === "cancelado") return false;
  if (status === "listo") return false;
  return status === "en_preparacion" || work === "en_preparacion" || work === "pausado";
}

function renderUnfinishedOrders() {
  const root = document.getElementById("eq-unfinished-list");
  if (!root || !currentUser) return;
  const unfinishedSessions = teamSessions.filter((s) => {
    if (String(s.userId || "") !== currentUser.uid) return false;
    const st = normalizeSessionStatus(s.status);
    return st === "activa" || st === "pausada";
  });
  /** @type {Record<string, { orderId: string, clientName: string, product: string, workStatus: string, elapsedMs: number, isActive: boolean }>} */
  const items = {};
  for (const s of unfinishedSessions) {
    const orderId = String(s.linkedOrderId || "");
    if (!orderId) continue;
    const st = normalizeSessionStatus(s.status);
    const sameAsUi =
      currentWorkSession.firestoreSessionId && String(s.id) === String(currentWorkSession.firestoreSessionId);
    const elapsedMs = sameAsUi ? elapsedMsNow() : sessionElapsedMs(s);
    items[orderId] = {
      orderId,
      clientName: String(s.linkedOrderClientName || "Cliente"),
      product: String(s.linkedOrderProduct || "Pedido"),
      workStatus: st === "activa" ? "en_preparacion" : "pausado",
      elapsedMs,
      isActive: st === "activa",
    };
  }
  for (const o of pendingOrders.filter(isUnfinishedOrder)) {
    const orderId = String(o.id || "");
    if (!orderId || items[orderId]) continue;
    items[orderId] = {
      orderId,
      clientName: String(o.clientName || "Cliente"),
      product: String(o.product || "Pedido"),
      workStatus: String(o.workStatus || o.status || "en_preparacion"),
      elapsedMs: Number(o.totalLaborHours) > 0 ? Number(o.totalLaborHours) * 60 * 60 * 1000 : 0,
      isActive: false,
    };
  }
  root.replaceChildren();
  const rows = Object.values(items);
  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "eq-unfinished__empty";
    p.textContent = "No hay pedidos en preparación.";
    root.appendChild(p);
    return;
  }
  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "eq-unfinished__item";
    const meta = document.createElement("div");
    meta.className = "eq-unfinished__meta";
    const name = document.createElement("p");
    name.className = "eq-unfinished__name";
    name.textContent = `${row.clientName} · ${row.product}`;
    const detail = document.createElement("p");
    detail.className = "eq-unfinished__detail";
    detail.textContent = `${row.workStatus} · ${formatDurationMs(row.elapsedMs)}`;
    meta.append(name, detail);
    const actions = document.createElement("div");
    actions.className = "eq-unfinished__actions";

    const resumeBtn = document.createElement("button");
    resumeBtn.type = "button";
    resumeBtn.className = "dash-quick-btn eq-unfinished__btn";
    resumeBtn.textContent = row.isActive ? "En curso" : "Retomar";
    resumeBtn.disabled = row.isActive;
    resumeBtn.addEventListener("click", () => {
      const picker = document.getElementById("eq-linked-order-picker");
      if (picker && "value" in picker) picker.value = row.orderId;
      renderLinkedOrderSummary();
      resumeWork().catch((e) => {
        console.error(e);
        showLoadError("No se pudo retomar el pedido.");
      });
    });

    const readyBtn = document.createElement("button");
    readyBtn.type = "button";
    readyBtn.className = "dash-quick-btn eq-unfinished__btn";
    readyBtn.textContent = "Marcar listo";
    readyBtn.addEventListener("click", () => {
      markPreparationOrderReady(row.orderId).catch((e) => {
        console.error(e);
        if (!handleEquipoFirestorePermissionDenied("marcar listo", e)) {
          showLoadError("No se pudo marcar listo el pedido.");
        }
      });
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "dash-quick-btn eq-unfinished__btn";
    removeBtn.textContent = "Quitar";
    removeBtn.addEventListener("click", () => {
      removePreparationOrder(row.orderId).catch((e) => {
        console.error(e);
        if (!handleEquipoFirestorePermissionDenied("quitar preparación", e)) {
          showLoadError("No se pudo quitar el pedido de preparación.");
        }
      });
    });
    actions.append(resumeBtn, readyBtn, removeBtn);
    item.append(meta, actions);
    root.append(item);
  }
}

function findPausedSessionByOrder(orderId) {
  if (!currentUser) return null;
  return (
    teamSessions.find(
      (s) =>
        String(s.userId || "") === currentUser.uid &&
        normalizeSessionStatus(s.status) === "pausada" &&
        String(s.linkedOrderId || "") === String(orderId || ""),
    ) || null
  );
}

function findRunningSession() {
  if (!currentUser) return null;
  return (
    teamSessions.find(
      (s) => String(s.userId || "") === currentUser.uid && normalizeSessionStatus(s.status) === "activa",
    ) || null
  );
}

function findMyOpenSession() {
  if (!currentUser) return null;
  return (
    teamSessions.find(
      (s) => String(s.userId || "") === currentUser.uid && normalizeSessionStatus(s.status) === "activa",
    ) ||
    teamSessions.find(
      (s) => String(s.userId || "") === currentUser.uid && normalizeSessionStatus(s.status) === "pausada",
    ) ||
    null
  );
}

async function pauseSessionRemote(session, reason = "manual") {
  if (!businessId || !session?.id) return;
  const sessionRef = scopedDoc("teamSessions", session.id);
  if (!sessionRef) return;
  const resumedAt = tsToDate(session.resumedAt) || tsToDate(session.startedAt) || tsToDate(session.startTime);
  const tracked = Number(session.totalTrackedMs) || 0;
  const extra = resumedAt ? Math.max(0, Date.now() - resumedAt.getTime()) : 0;
  const nextTracked = tracked + extra;
  await updateDoc(sessionRef, {
    status: "pausada",
    pausedAt: Timestamp.now(),
    resumedAt: null,
    totalTrackedMs: nextTracked,
    linkedOrderWorkStatus: "pausado",
    updatedAt: serverTimestamp(),
  });
  if (session.linkedOrderId) {
    const ord = scopedDoc("orders", session.linkedOrderId);
    if (!ord) return;
    await updateDoc(ord, {
      workStatus: "en_preparacion",
      currentOperatorId: currentUser?.uid || null,
      lastWorkedAt: serverTimestamp(),
    });
  }
  console.log("[Team] work session paused remote", String(session.id), reason);
}

async function resumeSessionRemote(session) {
  if (!businessId || !session?.id) return;
  const sessionRef = scopedDoc("teamSessions", session.id);
  if (!sessionRef) return;
  await updateDoc(sessionRef, {
    status: "activa",
    resumedAt: Timestamp.now(),
    pausedAt: null,
    linkedOrderWorkStatus: "en_preparacion",
    updatedAt: serverTimestamp(),
  });
  if (session.linkedOrderId) {
    const ord = scopedDoc("orders", session.linkedOrderId);
    if (!ord) return;
    await updateDoc(ord, {
      workStatus: "en_preparacion",
      status: "en_preparacion",
      currentOperatorId: currentUser?.uid || null,
      lastWorkedAt: serverTimestamp(),
    });
  }
  console.log("[Team] work session resumed remote", String(session.id));
}

async function markPreparationOrderReady(orderId) {
  if (!businessId || !orderId) return;
  const orderRef = scopedDoc("orders", orderId);
  if (!orderRef) return;
  await updateDoc(orderRef, {
    workStatus: "listo",
    status: "listo",
    currentOperatorId: null,
    lastWorkedAt: serverTimestamp(),
  });
  if (
    currentWorkSession.orderId &&
    String(currentWorkSession.orderId) === String(orderId) &&
    (currentWorkSession.sessionStatus === "activa" || currentWorkSession.sessionStatus === "pausada")
  ) {
    await finalizeWork();
  }
  renderUnfinishedOrders();
  updateWorkControlUI();
}

async function removePreparationOrder(orderId) {
  if (!businessId || !orderId) return;
  const confirmed = window.confirm("¿Quitar este pedido de preparación? Esto no lo entrega, solo lo saca del flujo de equipo.");
  if (!confirmed) return;
  const orderRef = scopedDoc("orders", orderId);
  if (!orderRef) return;
  const snap = await getDoc(orderRef);
  if (!snap.exists()) return;
  const data = snap.data() || {};
  const nextStatus = String(data.status || "").toLowerCase() === "en_preparacion" ? "nuevo" : String(data.status || "nuevo");
  await updateDoc(orderRef, {
    workStatus: "sin_iniciar",
    status: nextStatus || "nuevo",
    currentOperatorId: null,
    lastWorkedAt: serverTimestamp(),
  });
  const open = findMyOpenSession();
  if (open && String(open.linkedOrderId || "") === String(orderId)) {
    await pauseSessionRemote(open, "remove_preparation");
    resetWorkSessionLocal();
  }
  renderUnfinishedOrders();
  updateWorkControlUI();
}

function getVal(id) {
  const el = document.getElementById(id);
  return el && "value" in el ? String(el.value) : "";
}

function setVal(id, text) {
  const el = document.getElementById(id);
  if (el && "value" in el) el.value = text ?? "";
}

function getCheckedDays() {
  return Array.from(document.querySelectorAll('input[name="eq-day"]:checked')).map((el) => el.value);
}

function setCheckedDays(days) {
  const set = new Set(normalizeWorkDays(days));
  document.querySelectorAll('input[name="eq-day"]').forEach((el) => {
    if (el instanceof HTMLInputElement) {
      el.checked = set.has(el.value);
    }
  });
}

const modal = () => document.getElementById("eq-modal");

function openModal(memberId) {
  const host = modal();
  if (!host) return;
  const isEdit = typeof memberId === "string" && memberId.trim();
  const title = document.getElementById("eq-modal-title");
  const lead = document.getElementById("eq-modal-lead");
  if (title) title.textContent = isEdit ? "Editar miembro" : "Agregar miembro";
  if (lead) {
    lead.textContent = isEdit
      ? "Actualiza los datos operativos de esta persona."
      : "Datos operativos para organizar turnos y responsabilidades.";
  }

  const err = document.getElementById("eq-form-error");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }

  if (isEdit) {
    const m = members.find((x) => x.id === memberId);
    if (!m) return;
    setVal("eq-edit-id", m.id);
    setVal("eq-full-name", typeof m.fullName === "string" ? m.fullName : "");
    setVal("eq-role-title", typeof m.roleTitle === "string" ? m.roleTitle : "");
    setVal("eq-staff-category", normalizeCategory(m.staffCategory));
    setVal("eq-phone", typeof m.phone === "string" ? m.phone : "");
    setVal("eq-email", typeof m.email === "string" ? m.email : "");
    setVal("eq-hourly-rate", Number.isFinite(Number(m.hourlyRate)) ? String(Number(m.hourlyRate)) : "");
    const activeEl = document.getElementById("eq-active");
    if (activeEl instanceof HTMLInputElement) activeEl.checked = m.active !== false;
    setCheckedDays(m.workDays);
    setVal("eq-hours-from", typeof m.hoursFrom === "string" ? m.hoursFrom : "");
    setVal("eq-hours-to", typeof m.hoursTo === "string" ? m.hoursTo : "");
  } else {
    setVal("eq-edit-id", "");
    setVal("eq-full-name", "");
    setVal("eq-role-title", "");
    setVal("eq-staff-category", "operativo");
    setVal("eq-phone", "");
    setVal("eq-email", "");
    setVal("eq-hourly-rate", "");
    const activeEl = document.getElementById("eq-active");
    if (activeEl instanceof HTMLInputElement) activeEl.checked = true;
    setCheckedDays([]);
    setVal("eq-hours-from", "");
    setVal("eq-hours-to", "");
  }

  host.hidden = false;
  host.setAttribute("aria-hidden", "false");
  document.body.classList.add("cf-modal-open");
  document.getElementById("eq-full-name")?.focus();
}

function closeModal() {
  const host = modal();
  if (!host) return;
  host.hidden = true;
  host.setAttribute("aria-hidden", "true");
  document.body.classList.remove("cf-modal-open");
}

function showFormError(msg) {
  const el = document.getElementById("eq-form-error");
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

async function confirmDelete(id, name) {
  const ok = window.confirm(
    `¿Eliminar a ${name} del equipo? Esta acción no se puede deshacer.`,
  );
  if (!ok || !businessId) return;
  try {
    const ref = scopedDoc("teamMembers", id);
    if (!ref) return;
    await deleteDoc(ref);
    members = await fetchTeamMembersForBusiness(db, businessId);
    renderList(members);
    updateStats(members);
  } catch (e) {
    console.error(e);
    if (!handleEquipoFirestorePermissionDenied("eliminar miembro", e)) {
      showLoadError("No se pudo eliminar. Revisa tu conexión e inténtalo otra vez.");
    }
  }
}

async function submitForm(ev) {
  ev.preventDefault();
  if (!businessId) return;

  const fullName = getVal("eq-full-name").trim();
  const roleTitle = getVal("eq-role-title").trim();
  if (!fullName || !roleTitle) {
    showFormError("Nombre y cargo son obligatorios.");
    return;
  }
  showFormError("");

  const workDays = getCheckedDays();
  const hourlyRateRaw = Number(getVal("eq-hourly-rate").trim());
  const payload = {
    fullName,
    roleTitle,
    staffCategory: getVal("eq-staff-category").trim() || "operativo",
    phone: getVal("eq-phone").trim(),
    email: getVal("eq-email").trim(),
    active: (() => {
      const el = document.getElementById("eq-active");
      return el instanceof HTMLInputElement ? el.checked : true;
    })(),
    workDays,
    hoursFrom: getVal("eq-hours-from").trim(),
    hoursTo: getVal("eq-hours-to").trim(),
    hourlyRate:
      Number.isFinite(hourlyRateRaw) && hourlyRateRaw >= 0 ? hourlyRateRaw : getDefaultHourlyRate(),
    updatedAt: serverTimestamp(),
  };

  const editId = getVal("eq-edit-id").trim();

  try {
    if (editId) {
      const ref = scopedDoc("teamMembers", editId);
      if (!ref) return;
      await updateDoc(ref, payload);
    } else {
      const col = scopedCollection("teamMembers");
      if (!col) return;
      await addDoc(col, {
        ...payload,
        createdAt: serverTimestamp(),
      });
    }
    closeModal();
    members = await fetchTeamMembersForBusiness(db, businessId);
    renderList(members);
    updateStats(members);
    prefillWorkHourlyRate();
  } catch (e) {
    console.error(e);
    if (handleEquipoFirestorePermissionDenied("guardar miembro", e)) {
      showFormError("");
    } else {
      showFormError("No se pudo guardar. Revisa tu conexión e inténtalo otra vez.");
    }
  }
}

function memberForCurrentUser() {
  if (!currentUser) return null;
  const byUid = members.find((m) => typeof m.userId === "string" && m.userId === currentUser.uid);
  if (byUid) return byUid;
  const email = String(currentUser.email || "").toLowerCase();
  if (email) {
    const byEmail = members.find(
      (m) => typeof m.email === "string" && m.email.trim().toLowerCase() === email,
    );
    if (byEmail) return byEmail;
  }
  return null;
}

function currentUserDisplayName() {
  const fromTeam = memberForCurrentUser();
  if (fromTeam && typeof fromTeam.fullName === "string" && fromTeam.fullName.trim()) return fromTeam.fullName.trim();
  if (currentUser?.displayName && currentUser.displayName.trim()) return currentUser.displayName.trim();
  if (currentUser?.email && currentUser.email.trim()) return currentUser.email.trim();
  return "Owner";
}

function updateTimePanelHeader() {
  const label = document.getElementById("eq-time-user-label");
  if (!label) return;
  label.textContent = `Operador: ${currentUserDisplayName()}`;
}

function logEquipoLayoutMetrics(source = "unknown") {
  const main = document.getElementById("dash-main");
  const workspace = document.querySelector(".eq-workspace");
  const control = document.getElementById("eq-time-panel");
  console.log("[Equipo Layout] module mounted", source, {
    mainClientHeight: main?.clientHeight ?? null,
    mainScrollHeight: main?.scrollHeight ?? null,
    workspaceClientHeight: workspace instanceof HTMLElement ? workspace.clientHeight : null,
    workspaceScrollHeight: workspace instanceof HTMLElement ? workspace.scrollHeight : null,
    controlClientHeight: control?.clientHeight ?? null,
    controlScrollHeight: control?.scrollHeight ?? null,
  });
}

async function addFinanceExpenseLabor({ amount, operatorName, orderId, endDate }) {
  if (!businessId) return null;
  const col = scopedCollection("finance");
  if (!col) return;
  const ref = await addDoc(col, {
    type: "expense",
    category: "mano_obra",
    description: `Pago por horas - ${operatorName}`,
    amount,
    date: Timestamp.fromDate(endDate),
    linkedOrderId: orderId || null,
    orderId: orderId || null,
    clientId: null,
    status: "cobrado",
    createdBy: "system",
    createdAt: serverTimestamp(),
  });
  console.log("finance expense created", ref.id);
  return ref;
}

async function startWork() {
  console.log("startWork called");
  showLoadError("");
  try {
    if (!businessId || !currentUser) {
      const msg = "sin negocio o usuario";
      console.log("startWork failed:", msg);
      showLoadError("No se pudo iniciar la jornada.");
      return;
    }
    const linked = selectedLinkedOrder();
    if (!linked || !String(linked.id || "").trim()) {
      const msg = "debes seleccionar un pedido pendiente";
      console.log("startWork failed:", msg);
      showLoadError("Selecciona un pedido para iniciar.");
      return;
    }
    const rate = getWorkHourlyRateFromInput();
    if (!Number.isFinite(rate) || rate <= 0) {
      const msg = "tarifa por hora inválida (debe ser mayor que 0)";
      console.log("startWork failed:", msg);
      showLoadError("Indica una tarifa por hora válida.");
      return;
    }
    saveWorkHourlyRateToStorage(rate);

    const linkedOrderId = String(linked.id || "");
    const linkedOrderStatus = String(linked.status || "");
    const running = findRunningSession();
    if (running && String(running.linkedOrderId || "") === linkedOrderId) {
      const msg = "ya hay sesión activa para este pedido";
      console.log("startWork failed:", msg);
      showLoadError("Ya trabajas este pedido (sesión activa).");
      return;
    }
    if (findPausedSessionByOrder(linkedOrderId)) {
      const msg = "hay sesión pausada para este pedido — usa Retomar";
      console.log("startWork failed:", msg);
      showLoadError("Este pedido está pausado. Usa «Retomar».");
      return;
    }
    if (running && String(running.linkedOrderId || "") !== linkedOrderId) {
      await pauseSessionRemote(running, "switch_order");
    }

    const member = memberForCurrentUser();
    const userName = currentUserDisplayName();
    const orderRef = scopedDoc("orders", linkedOrderId);
    if (!orderRef) return;
    const statusToWrite = linkedOrderStatus === "nuevo" ? "en_preparacion" : linkedOrderStatus;
    await updateDoc(orderRef, {
      status: statusToWrite || "en_preparacion",
      workStatus: "en_preparacion",
      currentOperatorId: currentUser.uid,
      lastWorkedAt: serverTimestamp(),
    });

    const nowTs = Timestamp.now();
    const sessionsCol = scopedCollection("teamSessions");
    if (!sessionsCol) return;
    const sessionRef = await addDoc(sessionsCol, {
      operatorId: currentUser.uid,
      operatorName: userName,
      userId: currentUser.uid,
      userName,
      memberId: member?.id || null,
      status: "activa",
      startedAt: nowTs,
      resumedAt: nowTs,
      endedAt: null,
      totalTrackedMs: 0,
      calculatedPay: 0,
      startTime: nowTs,
      endTime: null,
      totalHours: 0,
      totalPay: 0,
      hourlyRate: rate,
      linkedOrderId,
      linkedOrderClientName: String(linked.clientName || ""),
      linkedOrderProduct: String(linked.product || ""),
      linkedOrderStatus: linkedOrderStatus,
      linkedOrderWorkStatus: "en_preparacion",
      pausedAt: null,
      pausedDurationMs: 0,
      createdAt: nowTs,
      updatedAt: serverTimestamp(),
    });

    const localDoc = {
      id: sessionRef.id,
      userId: currentUser.uid,
      status: "activa",
      resumedAt: nowTs,
      startedAt: nowTs,
      totalTrackedMs: 0,
      hourlyRate: rate,
      linkedOrderId,
      linkedOrderClientName: String(linked.clientName || ""),
      linkedOrderProduct: String(linked.product || ""),
      linkedOrderWorkStatus: "en_preparacion",
    };
    teamSessions = [...teamSessions.filter((s) => String(s.id) !== sessionRef.id), localDoc];
    syncCurrentWorkFromFirestoreDoc(localDoc);
    renderUnfinishedOrders();
  } catch (e) {
    console.log("startWork failed:", e instanceof Error ? e.message : String(e));
    console.error(e);
    if (!handleEquipoFirestorePermissionDenied("startWork", e)) {
      showLoadError("No se pudo iniciar la jornada.");
    }
  }
}

async function pauseWork() {
  console.log("pauseWork called");
  showLoadError("");
  try {
    if (!businessId || !currentUser) return;
    if (currentWorkSession.sessionStatus !== "activa" || !currentWorkSession.firestoreSessionId) return;
    const sid = currentWorkSession.firestoreSessionId;
    const session = teamSessions.find((s) => String(s.id) === String(sid));
    if (!session) {
      console.log("pauseWork failed: no session in local cache");
      return;
    }
    stopWorkTimer();
    const resumedAt = tsToDate(session.resumedAt) || tsToDate(session.startedAt) || tsToDate(session.startTime);
    const tracked = Number(session.totalTrackedMs) || 0;
    const extra = resumedAt ? Math.max(0, Date.now() - resumedAt.getTime()) : 0;
    const nextTracked = tracked + extra;
    await pauseSessionRemote(session, "ui_pause");
    currentWorkSession.sessionStatus = "pausada";
    currentWorkSession.startedAt = null;
    currentWorkSession.accumulatedMs = nextTracked;
    currentWorkSession.orderStatus = "en_preparacion";
    const updated = {
      ...session,
      status: "pausada",
      totalTrackedMs: nextTracked,
      resumedAt: null,
    };
    teamSessions = teamSessions.map((s) => (String(s.id) === String(sid) ? { ...s, ...updated } : s));
    updateWorkControlUI();
    renderUnfinishedOrders();
  } catch (e) {
    console.error(e);
    if (!handleEquipoFirestorePermissionDenied("pauseWork", e)) {
      showLoadError("No se pudo pausar.");
    }
  }
}

async function resumeWork() {
  console.log("resumeWork called");
  showLoadError("");
  try {
    if (!businessId || !currentUser) return;
    const linked = selectedLinkedOrder();
    const orderId = linked ? String(linked.id || "") : "";
    let paused = currentWorkSession.sessionStatus === "pausada" ? findMyOpenSession() : null;
    if (!paused && orderId) {
      paused = findPausedSessionByOrder(orderId);
    }
    if (!paused || !paused.id) {
      showLoadError("No hay sesión pausada para retomar.");
      return;
    }
    if (orderId && String(paused.linkedOrderId || "") !== orderId) {
      const picker = document.getElementById("eq-linked-order-picker");
      if (picker && "value" in picker) picker.value = String(paused.linkedOrderId || "");
      renderLinkedOrderSummary();
    }
    await resumeSessionRemote(paused);
    const updated = {
      ...paused,
      status: "activa",
      resumedAt: Timestamp.now(),
      pausedAt: null,
      totalTrackedMs: Number(paused.totalTrackedMs) || currentWorkSession.accumulatedMs || 0,
    };
    teamSessions = teamSessions.map((s) => (String(s.id) === String(paused.id) ? { ...s, ...updated } : s));
    syncCurrentWorkFromFirestoreDoc(updated);
    renderUnfinishedOrders();
  } catch (e) {
    console.error(e);
    if (!handleEquipoFirestorePermissionDenied("resumeWork", e)) {
      showLoadError("No se pudo retomar.");
    }
  }
}

async function finalizeWork() {
  console.log("finalizeWork called");
  showLoadError("");
  try {
    if (!businessId || !currentUser) return;
    if (currentWorkSession.sessionStatus !== "activa" && currentWorkSession.sessionStatus !== "pausada") return;
    if (!currentWorkSession.firestoreSessionId) return;

    stopWorkTimer();
    let totalMs = currentWorkSession.accumulatedMs;
    if (currentWorkSession.sessionStatus === "activa" && currentWorkSession.startedAt != null) {
      totalMs += Date.now() - currentWorkSession.startedAt;
    }
    const totalHours = totalMs / (1000 * 60 * 60);
    const rate = Number(currentWorkSession.hourlyRate) || getWorkHourlyRateFromInput() || memberHourlyRate(memberForCurrentUser() || {});
    const totalPay = Number((totalHours * rate).toFixed(2));
    const end = new Date();
    const operatorName = currentUserDisplayName();
    const orderId = currentWorkSession.orderId;
    const sid = currentWorkSession.firestoreSessionId;

    const sessionRef = scopedDoc("teamSessions", sid);
    if (!sessionRef) return;
    await updateDoc(sessionRef, {
      status: "finalizada",
      endedAt: Timestamp.fromDate(end),
      endTime: Timestamp.fromDate(end),
      pausedAt: null,
      resumedAt: null,
      totalTrackedMs: Math.round(totalMs),
      totalHours,
      totalPay,
      calculatedPay: totalPay,
      linkedOrderWorkStatus: "listo",
      updatedAt: serverTimestamp(),
    });

    if (orderId) {
      const orderRef = scopedDoc("orders", orderId);
      if (!orderRef) return;
      try {
        const snap = await getDoc(orderRef);
        if (snap.exists()) {
          const data = snap.data() || {};
          const prevHours = Number(data.totalLaborHours) || 0;
          const prevCost = Number(data.totalLaborCost) || 0;
          const rawStatus = String(data.status || "");
          const keepDelivered = rawStatus === "entregado" || rawStatus === "cancelado";
          await updateDoc(orderRef, {
            totalLaborHours: prevHours + totalHours,
            totalLaborCost: Number((prevCost + totalPay).toFixed(2)),
            lastWorkedAt: serverTimestamp(),
            workStatus: "listo",
            currentOperatorId: null,
            status: keepDelivered ? rawStatus : "listo",
          });
        }
      } catch (e) {
        if (!handleEquipoFirestorePermissionDenied("finalizeWork order labor", e)) {
          console.warn("[Team] update order labor fields", e);
        }
      }
    }

    await addFinanceExpenseLabor({
      amount: totalPay,
      operatorName,
      orderId,
      endDate: end,
    });

    console.log("session finalized", totalPay);

    resetWorkSessionLocal();
    renderUnfinishedOrders();
  } catch (e) {
    console.error(e);
    if (!handleEquipoFirestorePermissionDenied("finalizeWork", e)) {
      showLoadError("No se pudo finalizar la jornada.");
    }
  }
}

function subscribePendingOrders() {
  if (!businessId) return;
  if (unsubPendingOrders) {
    unsubPendingOrders();
    unsubPendingOrders = null;
  }
  const colOrders = scopedCollection("orders");
  if (!colOrders) return;
  const qy = query(colOrders, orderBy("createdAt", "desc"), limit(250));
  unsubPendingOrders = onSnapshot(
    qy,
    (snap) => {
      pendingOrders = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((o) => isPendingOrderStatus(o.status));
      renderPendingOrdersPicker();
      renderUnfinishedOrders();
    },
    (err) => {
      console.error(err);
      if (!handleEquipoFirestorePermissionDenied("subscribePendingOrders", err)) {
        showLoadError("No se pudieron cargar pedidos pendientes para vincular.");
      }
    },
  );
}

function subscribeTeamSessions() {
  if (!businessId || !currentUser) return;
  if (unsubSessions) {
    unsubSessions();
    unsubSessions = null;
  }
  const colSessions = scopedCollection("teamSessions");
  if (!colSessions) return;
  const qy = query(colSessions, limit(500));
  unsubSessions = onSnapshot(
    qy,
    (snap) => {
      teamSessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      teamSessions.sort((a, b) => {
        const ta = Math.max(tsToMillis(a.updatedAt), tsToMillis(a.resumedAt), tsToMillis(a.createdAt), tsToMillis(a.startedAt));
        const tb = Math.max(tsToMillis(b.updatedAt), tsToMillis(b.resumedAt), tsToMillis(b.createdAt), tsToMillis(b.startedAt));
        return tb - ta;
      });
      const mine = findMyOpenSession();
      if (mine) {
        const mineSt = normalizeSessionStatus(mine.status);
        const idMatch =
          currentWorkSession.firestoreSessionId &&
          String(currentWorkSession.firestoreSessionId) === String(mine.id);
        if (idMatch && currentWorkSession.sessionStatus === "activa" && mineSt === "activa") {
          if (!workTimerInterval) startWorkTimer();
          updateWorkControlUI();
        } else if (idMatch && currentWorkSession.sessionStatus === "pausada" && mineSt === "pausada") {
          currentWorkSession.accumulatedMs = Math.max(0, Number(mine.totalTrackedMs) || 0);
          updateWorkControlUI();
        } else {
          syncCurrentWorkFromFirestoreDoc(mine);
        }
      } else {
        resetWorkSessionLocal();
      }
      renderUnfinishedOrders();
    },
    (err) => {
      console.error(err);
      if (!handleEquipoFirestorePermissionDenied("subscribeTeamSessions", err)) {
        showLoadError("No se pudo cargar el control de jornada.");
      }
    },
  );
}

function wireTimeTracking() {
  document.getElementById("eq-btn-start")?.addEventListener("click", () => {
    startWork();
  });
  document.getElementById("eq-btn-pause")?.addEventListener("click", () => {
    pauseWork();
  });
  document.getElementById("eq-btn-resume")?.addEventListener("click", () => {
    resumeWork();
  });
  document.getElementById("eq-btn-finish")?.addEventListener("click", () => {
    finalizeWork();
  });
  document.getElementById("eq-work-hourly-rate")?.addEventListener("change", () => {
    const r = getWorkHourlyRateFromInput();
    if (Number.isFinite(r) && r > 0) saveWorkHourlyRateToStorage(r);
  });
  document.getElementById("eq-linked-order-picker")?.addEventListener("change", () => {
    renderLinkedOrderSummary();
    renderWorkButtons();
  });
  document.getElementById("eq-btn-clear-linked-order")?.addEventListener("click", () => {
    const picker = document.getElementById("eq-linked-order-picker");
    if (picker && "value" in picker) picker.value = "";
    renderLinkedOrderSummary();
    renderWorkButtons();
  });
}

function wireModal() {
  document.getElementById("eq-open-add")?.addEventListener("click", () => openModal(null));
  document.getElementById("eq-modal-backdrop")?.addEventListener("click", closeModal);
  document.getElementById("eq-modal-cancel")?.addEventListener("click", closeModal);
  document.getElementById("eq-member-form")?.addEventListener("submit", submitForm);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal() && !modal()?.hidden) {
      closeModal();
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;

  initDashShell({ auth, db });

  try {
    const business = await resolveBusinessForUser(db, user);
    if (!business) {
      showLoadError("No encontramos un negocio asociado a tu cuenta.");
      if (unsubSessions) {
        unsubSessions();
        unsubSessions = null;
      }
      if (unsubPendingOrders) {
        unsubPendingOrders();
        unsubPendingOrders = null;
      }
      pendingOrders = [];
      renderHeader(null);
      members = [];
      renderList(members);
      updateStats(members);
      renderPendingOrdersPicker();
      return;
    }

    businessId = business.id;
    scopeUid = business?.scope?.uid || user.uid || null;
    renderHeader(business);
    members = await fetchTeamMembersForBusiness(db, businessId);
    renderList(members);
    updateStats(members);
    updateTimePanelHeader();
    prefillWorkHourlyRate();
    subscribeTeamSessions();
    subscribePendingOrders();
    renderLinkedOrderSummary();
    renderWorkButtons();
    showLoadError("");
    logEquipoLayoutMetrics("auth-success");
    let eqLayoutResizeDebounce = null;
    if (!window.__eqLayoutResizeWired) {
      window.__eqLayoutResizeWired = true;
      window.addEventListener("resize", () => {
        if (eqLayoutResizeDebounce) clearTimeout(eqLayoutResizeDebounce);
        eqLayoutResizeDebounce = setTimeout(() => logEquipoLayoutMetrics("resize"), 120);
      });
    }
  } catch (e) {
    console.error(e);
    if (!handleEquipoFirestorePermissionDenied("carga inicial equipo", e)) {
      showLoadError("No se pudo cargar el equipo. Revisa tu conexión e inténtalo otra vez.");
    }
  }
});

wireModal();
wireTimeTracking();

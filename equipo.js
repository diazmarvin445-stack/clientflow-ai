import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
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

/** @type {string | null} */
let businessId = null;
/** @type {Record<string, unknown>[]} */
let members = [];
/** @type {import("https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js").User | null} */
let currentUser = null;
/** @type {Record<string, unknown>[]} */
let teamSessions = [];
/** @type {Record<string, unknown> | null} */
let activeSession = null;
/** @type {ReturnType<typeof setInterval> | null} */
let timerTicker = null;
/** @type {(() => void) | null} */
let unsubSessions = null;
/** @type {(() => void) | null} */
let unsubPendingOrders = null;
/** @type {Record<string, unknown>[]} */
let pendingOrders = [];

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
  const input = document.getElementById("eq-default-hourly-rate");
  if (input && "value" in input) {
    const uiVal = Number(input.value);
    if (Number.isFinite(uiVal) && uiVal >= 0) return uiVal;
  }
  const stored = Number(localStorage.getItem(defaultHourlyRateStorageKey(businessId)));
  if (Number.isFinite(stored) && stored >= 0) return stored;
  return DEFAULT_HOURLY_RATE_USD;
}

function setDefaultHourlyRateInput(rate) {
  const input = document.getElementById("eq-default-hourly-rate");
  if (input && "value" in input) input.value = String(rate);
}

function saveDefaultHourlyRateFromInput() {
  if (!businessId) return;
  const rate = getDefaultHourlyRate();
  localStorage.setItem(defaultHourlyRateStorageKey(businessId), String(rate));
  setDefaultHourlyRateInput(rate);
}

function memberHourlyRate(m) {
  const raw = Number(m.hourlyRate);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return getDefaultHourlyRate();
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

function isPendingOrderStatus(raw) {
  const s = String(raw || "").toLowerCase();
  return s === "nuevo" || s === "produccion" || s === "listo";
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

function renderLinkedOrderSummary() {
  const summary = document.getElementById("eq-linked-order-summary");
  if (!summary) return;
  const selected = selectedLinkedOrder();
  if (!selected) {
    summary.textContent = "No hay pedido vinculado.";
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
  noneOp.textContent = "Sin vincular";
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

function currentSessionElapsedMs() {
  if (!activeSession) return 0;
  const startedAt = tsToDate(activeSession.startTime);
  if (!startedAt) return 0;
  const pausedAccumulatedMs = Number(activeSession.pausedDurationMs) || 0;
  const pausedAt = tsToDate(activeSession.pausedAt);
  const isPaused = activeSession.status === "paused";
  const now = isPaused && pausedAt ? pausedAt.getTime() : Date.now();
  return Math.max(0, now - startedAt.getTime() - pausedAccumulatedMs);
}

function refreshTimeSummary() {
  const timerEl = document.getElementById("eq-active-timer");
  if (timerEl) timerEl.textContent = formatDurationMs(currentSessionElapsedMs());

  if (!currentUser) return;
  const now = new Date();
  let totalHoursToday = 0;
  let totalEarningsToday = 0;
  for (const s of teamSessions) {
    if (String(s.userId || "") !== currentUser.uid) continue;
    const startedAt = tsToDate(s.startTime);
    if (!startedAt || !sameDay(startedAt, now)) continue;
    const h = Number(s.totalHours);
    const pay = Number(s.totalPay);
    if (Number.isFinite(h) && h > 0) totalHoursToday += h;
    if (Number.isFinite(pay) && pay > 0) totalEarningsToday += pay;
  }
  const hoursEl = document.getElementById("eq-today-hours");
  const earnEl = document.getElementById("eq-today-earnings");
  if (hoursEl) hoursEl.textContent = totalHoursToday.toFixed(2);
  if (earnEl) earnEl.textContent = formatMoney(totalEarningsToday);
}

function renderSessionControlsState() {
  const startBtn = document.getElementById("eq-btn-start");
  const pauseBtn = document.getElementById("eq-btn-pause");
  const finishBtn = document.getElementById("eq-btn-finish");

  const hasActive = Boolean(activeSession);
  const paused = hasActive && activeSession.status === "paused";

  if (startBtn instanceof HTMLButtonElement) {
    startBtn.disabled = hasActive;
  }
  if (pauseBtn instanceof HTMLButtonElement) {
    pauseBtn.disabled = !hasActive;
    pauseBtn.textContent = paused ? "Reanudar" : "Pausar";
  }
  if (finishBtn instanceof HTMLButtonElement) {
    finishBtn.disabled = !hasActive;
  }
}

function ensureTimerTicker() {
  if (timerTicker) return;
  timerTicker = setInterval(() => {
    refreshTimeSummary();
  }, 1000);
}

function stopTimerTicker() {
  if (!timerTicker) return;
  clearInterval(timerTicker);
  timerTicker = null;
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
    await deleteDoc(doc(db, "businesses", businessId, "teamMembers", id));
    members = await fetchTeamMembersForBusiness(db, businessId);
    renderList(members);
    updateStats(members);
  } catch (e) {
    console.error(e);
    showLoadError("No se pudo eliminar. Revisa tu conexión e inténtalo otra vez.");
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
      await updateDoc(doc(db, "businesses", businessId, "teamMembers", editId), payload);
    } else {
      await addDoc(collection(db, "businesses", businessId, "teamMembers"), {
        ...payload,
        createdAt: serverTimestamp(),
      });
    }
    closeModal();
    members = await fetchTeamMembersForBusiness(db, businessId);
    renderList(members);
    updateStats(members);
  } catch (e) {
    console.error(e);
    showFormError("No se pudo guardar. Revisa tu conexión e inténtalo otra vez.");
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

async function startWorkSession() {
  if (!businessId || !currentUser) return;
  if (activeSession) return;
  const linkedOrder = selectedLinkedOrder();
  const linkedOrderId = linkedOrder ? String(linkedOrder.id || "") : "";
  const member = memberForCurrentUser();
  const rate = memberHourlyRate(member || {});
  const userName = currentUserDisplayName();

  await addDoc(collection(db, "businesses", businessId, "teamSessions"), {
    userId: currentUser.uid,
    userName,
    memberId: member?.id || null,
    status: "active",
    startTime: serverTimestamp(),
    endTime: null,
    totalHours: 0,
    totalPay: 0,
    hourlyRate: rate,
    linkedOrderId: linkedOrderId || null,
    linkedOrderClientName: linkedOrder ? String(linkedOrder.clientName || "") : null,
    linkedOrderProduct: linkedOrder ? String(linkedOrder.product || "") : null,
    linkedOrderStatus: linkedOrder ? String(linkedOrder.status || "") : null,
    pausedAt: null,
    pausedDurationMs: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

async function togglePauseSession() {
  if (!businessId || !activeSession) return;
  const sessionRef = doc(db, "businesses", businessId, "teamSessions", String(activeSession.id));
  const status = String(activeSession.status || "");
  if (status === "paused") {
    const pausedAt = tsToDate(activeSession.pausedAt);
    const pausedMs = pausedAt ? Math.max(0, Date.now() - pausedAt.getTime()) : 0;
    const prevPaused = Number(activeSession.pausedDurationMs) || 0;
    await updateDoc(sessionRef, {
      status: "active",
      pausedAt: null,
      pausedDurationMs: prevPaused + pausedMs,
      updatedAt: serverTimestamp(),
    });
    return;
  }
  await updateDoc(sessionRef, {
    status: "paused",
    pausedAt: Timestamp.now(),
    updatedAt: serverTimestamp(),
  });
}

async function finalizeSession() {
  if (!businessId || !currentUser || !activeSession) return;
  const end = new Date();
  const startedAt = tsToDate(activeSession.startTime);
  if (!startedAt) return;
  let pausedDurationMs = Number(activeSession.pausedDurationMs) || 0;
  if (activeSession.status === "paused") {
    const pausedAt = tsToDate(activeSession.pausedAt);
    if (pausedAt) pausedDurationMs += Math.max(0, end.getTime() - pausedAt.getTime());
  }
  const elapsedMs = Math.max(0, end.getTime() - startedAt.getTime() - pausedDurationMs);
  const totalHours = elapsedMs / (1000 * 60 * 60);
  const sessionRate =
    Number.isFinite(Number(activeSession.hourlyRate)) && Number(activeSession.hourlyRate) >= 0
      ? Number(activeSession.hourlyRate)
      : memberHourlyRate(memberForCurrentUser() || {});
  const totalPay = Number((totalHours * sessionRate).toFixed(2));

  const sessionRef = doc(db, "businesses", businessId, "teamSessions", String(activeSession.id));
  await updateDoc(sessionRef, {
    status: "completed",
    endTime: Timestamp.fromDate(end),
    pausedAt: null,
    pausedDurationMs,
    totalHours,
    totalPay,
    updatedAt: serverTimestamp(),
  });

  await addDoc(collection(db, "businesses", businessId, "finance"), {
    type: "expense",
    category: "mano_obra",
    description: `Pago por horas - ${currentUserDisplayName()}`,
    amount: totalPay,
    date: Timestamp.fromDate(end),
    linkedOrderId: activeSession.linkedOrderId || null,
    linkedOrderClientName: activeSession.linkedOrderClientName || null,
    linkedOrderProduct: activeSession.linkedOrderProduct || null,
    linkedOrderStatus: activeSession.linkedOrderStatus || null,
    orderId: activeSession.linkedOrderId || null,
    clientId: null,
    status: "cobrado",
    createdBy: "system",
    createdAt: serverTimestamp(),
  });
}

function subscribePendingOrders() {
  if (!businessId) return;
  if (unsubPendingOrders) {
    unsubPendingOrders();
    unsubPendingOrders = null;
  }
  const qy = query(collection(db, "businesses", businessId, "orders"), orderBy("createdAt", "desc"), limit(250));
  unsubPendingOrders = onSnapshot(
    qy,
    (snap) => {
      pendingOrders = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((o) => isPendingOrderStatus(o.status));
      renderPendingOrdersPicker();
    },
    (err) => {
      console.error(err);
      showLoadError("No se pudieron cargar pedidos pendientes para vincular.");
    },
  );
}

function subscribeTeamSessions() {
  if (!businessId || !currentUser) return;
  if (unsubSessions) {
    unsubSessions();
    unsubSessions = null;
  }
  const qy = query(
    collection(db, "businesses", businessId, "teamSessions"),
    orderBy("createdAt", "desc"),
    limit(500),
  );
  unsubSessions = onSnapshot(
    qy,
    (snap) => {
      teamSessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      activeSession =
        teamSessions.find(
          (s) =>
            String(s.userId || "") === currentUser?.uid &&
            (String(s.status || "") === "active" || String(s.status || "") === "paused"),
        ) ||
        null;
      renderSessionControlsState();
      refreshTimeSummary();
      if (activeSession) ensureTimerTicker();
      else stopTimerTicker();
    },
    (err) => {
      console.error(err);
      showLoadError("No se pudo cargar el control de jornada.");
    },
  );
}

function wireTimeTracking() {
  document.getElementById("eq-btn-start")?.addEventListener("click", () => {
    startWorkSession().catch((e) => {
      console.error(e);
      showLoadError("No se pudo iniciar la jornada.");
    });
  });
  document.getElementById("eq-btn-pause")?.addEventListener("click", () => {
    togglePauseSession().catch((e) => {
      console.error(e);
      showLoadError("No se pudo actualizar la pausa.");
    });
  });
  document.getElementById("eq-btn-finish")?.addEventListener("click", () => {
    finalizeSession().catch((e) => {
      console.error(e);
      showLoadError("No se pudo finalizar la jornada.");
    });
  });
  document.getElementById("eq-default-hourly-rate")?.addEventListener("change", () => {
    saveDefaultHourlyRateFromInput();
  });
  document.getElementById("eq-linked-order-picker")?.addEventListener("change", () => {
    renderLinkedOrderSummary();
  });
  document.getElementById("eq-btn-clear-linked-order")?.addEventListener("click", () => {
    const picker = document.getElementById("eq-linked-order-picker");
    if (picker && "value" in picker) picker.value = "";
    renderLinkedOrderSummary();
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
    setDefaultHourlyRateInput(getDefaultHourlyRate());
    renderHeader(business);
    members = await fetchTeamMembersForBusiness(db, businessId);
    renderList(members);
    updateStats(members);
    updateTimePanelHeader();
    subscribeTeamSessions();
    subscribePendingOrders();
    renderLinkedOrderSummary();
    showLoadError("");
  } catch (e) {
    console.error(e);
    showLoadError("No se pudo cargar el equipo. Revisa tu conexión e inténtalo otra vez.");
  }
});

wireModal();
wireTimeTracking();

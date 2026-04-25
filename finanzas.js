import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  limit,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  resolveBusinessForUser,
  formatBusinessMeta,
  initialsFromName,
  financeIncomeCountsTowardRealized,
} from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";

/** @typedef {'today' | 'week' | 'month' | 'all'} FinPeriod */

const INCOME_OPTIONS = [
  { value: "ventas", label: "Ventas" },
  { value: "anticipos", label: "Anticipos" },
  { value: "ganancias", label: "Ganancias (pedidos)" },
  { value: "otros_ingresos", label: "Otros ingresos" },
];

const EXPENSE_OPTIONS = [
  { value: "materiales", label: "Materiales" },
  { value: "transporte", label: "Transporte" },
  { value: "mano_obra", label: "Mano de obra" },
  { value: "personal", label: "Personal" },
  { value: "servicios", label: "Servicios" },
  { value: "alquiler", label: "Alquiler" },
  { value: "marketing", label: "Marketing" },
  { value: "otros_gastos", label: "Otros gastos" },
];

const ALL_CAT_LABELS = Object.fromEntries([
  ...INCOME_OPTIONS.map((o) => [o.value, o.label]),
  ...EXPENSE_OPTIONS.map((o) => [o.value, o.label]),
]);

/** @type {FinPeriod} */
let currentPeriod = "month";
/** @type {string | null} */
let businessId = null;
/** @type {(() => void) | null} */
let unsubFinance = null;
/** @type {(() => void) | null} */
let unsubFixedExpenses = null;

/** @type {{ id: string, type: string, amount: number, category: string, description: string, date: Date | null, createdBy?: string }[]} */
let rowsCache = [];

/** @type {{ id: string, name: string, amount: number, frequency: string, active: boolean }[]} */
let fixedExpensesCache = [];

/** YourColor / custom_apparel: gastos fijos mensuales en Finanzas. */
let yourColorFinMode = false;

/**
 * @param {{ data: Record<string, unknown> } | null | undefined} business
 */
function isYourColorFinanceBusiness(business) {
  if (!business?.data) return false;
  const name = String(business.data.businessName || "")
    .trim()
    .toLowerCase();
  const cat = String(business.data.businessCategory || "")
    .trim()
    .toLowerCase();
  return name === "yourcolor" || cat === "custom_apparel";
}

/**
 * @param {typeof fixedExpensesCache} rows
 */
function sumActiveFixedMonthlyTotal(rows) {
  let s = 0;
  for (const r of rows) {
    if (!r.active) continue;
    if (String(r.frequency || "monthly").toLowerCase() !== "monthly") continue;
    const a = Number(r.amount);
    if (Number.isFinite(a) && a > 0) s += a;
  }
  return s;
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

function showLoadError(msg) {
  const el = document.getElementById("fin-load-error");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function hideLoadError() {
  const el = document.getElementById("fin-load-error");
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
}

function formatUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0";
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatUsdSigned(n, isIncome) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0.00";
  const prefix = isIncome ? "+" : "-";
  return `${prefix}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * @param {Date} d
 */
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * @param {Date} d
 */
function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * Lunes como inicio de semana.
 * @param {Date} d
 */
function startOfWeekMonday(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return startOfDay(x);
}

/**
 * @param {Date} d
 */
function endOfWeekSunday(d) {
  const s = startOfWeekMonday(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  return endOfDay(e);
}

/**
 * @param {FinPeriod} period
 * @returns {{ start: Date | null, end: Date | null }}
 */
function periodBounds(period) {
  const now = new Date();
  if (period === "all") return { start: null, end: null };
  if (period === "today") {
    return { start: startOfDay(now), end: endOfDay(now) };
  }
  if (period === "week") {
    return { start: startOfWeekMonday(now), end: endOfWeekSunday(now) };
  }
  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }
  return { start: null, end: null };
}

/**
 * @param {Date | null} d
 * @param {{ start: Date | null, end: Date | null }} bounds
 */
function dateInBounds(d, bounds) {
  if (!d || Number.isNaN(d.getTime())) return false;
  if (!bounds.start || !bounds.end) return true;
  return d.getTime() >= bounds.start.getTime() && d.getTime() <= bounds.end.getTime();
}

/**
 * @param {FinPeriod} period
 */
function periodLabel(period) {
  if (period === "today") return "hoy";
  if (period === "week") return "esta semana";
  if (period === "month") return "este mes";
  return "total";
}

/**
 * @param {typeof rowsCache} rows
 * @param {FinPeriod} period
 */
function filterRows(rows, period) {
  const b = periodBounds(period);
  if (period === "all") return rows;
  return rows.filter((r) => dateInBounds(r.date, b));
}

/**
 * @param {typeof rowsCache} rows
 * @param {number} [fixedMonthlyAddon] suma de gastos fijos activos (solo período "month")
 */
function summarize(rows, fixedMonthlyAddon = 0) {
  let income = 0;
  let variableExpense = 0;
  for (const r of rows) {
    const a = Number(r.amount);
    if (!Number.isFinite(a) || a <= 0) continue;
    if (r.type === "income") {
      if (!financeIncomeCountsTowardRealized(r)) continue;
      income += a;
    } else if (r.type === "expense") variableExpense += a;
  }
  const addon = currentPeriod === "month" ? Math.max(0, fixedMonthlyAddon) : 0;
  const expense = variableExpense + addon;
  return { income, expense, variableExpense, net: income - expense };
}

function updateSummaryCards(rows) {
  const fixedAddon = yourColorFinMode ? sumActiveFixedMonthlyTotal(fixedExpensesCache) : 0;
  const { income, expense, net, variableExpense } = summarize(rows, fixedAddon);
  const incEl = document.getElementById("fin-sum-income");
  const expEl = document.getElementById("fin-sum-expense");
  const netEl = document.getElementById("fin-sum-net");
  const cardNet = document.getElementById("fin-card-net");
  const expNote = document.getElementById("fin-sum-expense-note");
  if (incEl) incEl.textContent = formatUsd(income);
  if (expEl) expEl.textContent = formatUsd(expense);
  if (expNote) {
    if (yourColorFinMode && currentPeriod === "month" && fixedAddon > 0) {
      expNote.hidden = false;
      expNote.textContent = `Incluye gastos fijos: ${formatUsd(fixedAddon)} · Variables: ${formatUsd(variableExpense)}`;
    } else {
      expNote.hidden = true;
      expNote.textContent = "";
    }
  }
  if (netEl) {
    netEl.textContent = formatUsd(net);
    netEl.classList.remove("fin-card-value--pos", "fin-card-value--neg");
    if (net >= 0) netEl.classList.add("fin-card-value--pos");
    else netEl.classList.add("fin-card-value--neg");
  }
  if (cardNet) {
    cardNet.classList.remove("fin-card--net-positive", "fin-card--net-negative");
    if (net >= 0) cardNet.classList.add("fin-card--net-positive");
    else cardNet.classList.add("fin-card--net-negative");
  }

  const meta = document.getElementById("fin-meta");
  if (meta) {
    const filtered = filterRows(rowsCache, currentPeriod);
    meta.textContent = `${filtered.length} ${filtered.length === 1 ? "movimiento" : "movimientos"} · ${periodLabel(currentPeriod)}`;
  }
}

/**
 * @param {unknown} ts
 */
function tsToDate(ts) {
  if (ts == null) return null;
  if (typeof ts === "object" && ts !== null && typeof /** @type {{ toDate?: () => Date }} */ (ts).toDate === "function") {
    try {
      const d = /** @type {{ toDate: () => Date }} */ (ts).toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  return null;
}

function renderList() {
  const root = document.getElementById("fin-list-root");
  if (!root) return;

  const filtered = filterRows(rowsCache, currentPeriod);
  filtered.sort((a, b) => {
    const ta = a.date?.getTime() ?? 0;
    const tb = b.date?.getTime() ?? 0;
    return tb - ta;
  });

  updateSummaryCards(filtered);

  root.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "fin-empty";
    empty.innerHTML =
      '<p class="fin-empty-title">No hay movimientos en este período.</p>' +
      '<p class="fin-empty-text">Usa el botón inferior o registra desde el Chat IA con Maya.</p>';
    root.appendChild(empty);
    return;
  }

  for (const row of filtered) {
    root.appendChild(buildRow(row));
  }
}

/**
 * @param {typeof rowsCache[0]} row
 */
function buildRow(row) {
  const article = document.createElement("article");
  article.className = "fin-row";
  const isIn = row.type === "income";
  article.classList.add(isIn ? "fin-row--income" : "fin-row--expense");

  const icon = document.createElement("div");
  icon.className = "fin-row-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = isIn ? "↑" : "↓";

  const main = document.createElement("div");
  main.className = "fin-row-main";

  const title = document.createElement("p");
  title.className = "fin-row-desc";
  const desc =
    (typeof row.description === "string" && row.description.trim()) || "—";
  title.textContent = desc;

  const sub = document.createElement("p");
  sub.className = "fin-row-cat";
  const catLabel = ALL_CAT_LABELS[row.category] || row.category || "—";
  const by =
    row.createdBy === "maya"
      ? " · Maya"
      : row.createdBy === "marvin"
        ? ""
        : "";
  const st = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
  const statusNote =
    row.type === "income" && st === "retenido"
      ? " · Depósito retenido (no ingreso hasta entrega)"
      : row.type === "income" && st === "cancelado"
        ? " · Anulado"
        : "";
  sub.textContent = `${catLabel}${by}${statusNote}`;

  main.append(title, sub);

  const right = document.createElement("div");
  right.className = "fin-row-right";

  const amt = document.createElement("span");
  amt.className = "fin-row-amount";
  amt.classList.add(isIn ? "fin-row-amount--in" : "fin-row-amount--out");
  amt.textContent = formatUsdSigned(row.amount, isIn);

  const dateEl = document.createElement("time");
  dateEl.className = "fin-row-date";
  const d = row.date;
  dateEl.dateTime = d ? d.toISOString().slice(0, 10) : "";
  dateEl.textContent = d
    ? d.toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : "—";

  const del = document.createElement("button");
  del.type = "button";
  del.className = "fin-row-delete";
  del.setAttribute("aria-label", "Eliminar movimiento");
  del.textContent = "🗑️";
  del.addEventListener("click", async () => {
    if (!businessId) return;
    if (!confirm("¿Eliminar este movimiento? Esta acción no se puede deshacer.")) return;
    del.disabled = true;
    try {
      await deleteDoc(doc(db, "businesses", businessId, "finance", row.id));
    } catch (e) {
      console.error(e);
      alert("No se pudo eliminar. Inténtalo de nuevo.");
      del.disabled = false;
    }
  });

  right.append(amt, dateEl, del);
  article.append(icon, main, right);
  return article;
}

/**
 * @param {typeof fixedExpensesCache[0]} row
 */
function buildFixedRow(row) {
  const li = document.createElement("li");
  li.className = "fin-fixed-item";
  if (!row.active) li.classList.add("fin-fixed-item--off");

  const left = document.createElement("div");
  const name = document.createElement("p");
  name.className = "fin-fixed-item__name";
  name.textContent = row.name;
  const meta = document.createElement("p");
  meta.className = "fin-fixed-item__meta";
  meta.textContent = row.frequency === "monthly" ? "Frecuencia: mensual" : `Frecuencia: ${row.frequency}`;
  left.append(name, meta);

  const amt = document.createElement("span");
  amt.className = "fin-fixed-item__amount";
  amt.textContent = formatUsd(row.amount);

  const toggle = document.createElement("label");
  toggle.className = "fin-fixed-toggle";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = row.active;
  cb.addEventListener("change", async () => {
    if (!businessId) return;
    try {
      await updateDoc(doc(db, "businesses", businessId, "fixedExpenses", row.id), {
        active: cb.checked,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error(e);
      cb.checked = !cb.checked;
      alert("No se pudo actualizar el estado.");
    }
  });
  const lab = document.createElement("span");
  lab.textContent = "Activo";
  toggle.append(cb, lab);

  const actions = document.createElement("div");
  actions.className = "fin-fixed-item__actions";
  const btnEd = document.createElement("button");
  btnEd.type = "button";
  btnEd.className = "fin-fixed-btn";
  btnEd.textContent = "Editar";
  btnEd.addEventListener("click", () => openFixedModal(row.id));
  const btnDel = document.createElement("button");
  btnDel.type = "button";
  btnDel.className = "fin-fixed-btn";
  btnDel.textContent = "Eliminar";
  btnDel.addEventListener("click", async () => {
    if (!businessId) return;
    if (!confirm("¿Eliminar este gasto fijo?")) return;
    btnDel.disabled = true;
    try {
      await deleteDoc(doc(db, "businesses", businessId, "fixedExpenses", row.id));
    } catch (e) {
      console.error(e);
      alert("No se pudo eliminar.");
      btnDel.disabled = false;
    }
  });
  actions.append(btnEd, btnDel);

  li.append(left, amt, toggle, actions);
  return li;
}

function renderFixedList() {
  const root = document.getElementById("fin-fixed-list");
  if (!root) return;
  root.replaceChildren();
  if (!yourColorFinMode) return;
  if (!fixedExpensesCache.length) {
    const li = document.createElement("li");
    li.className = "fin-empty-text";
    li.style.padding = "0.35rem 0";
    li.textContent = "No hay gastos fijos. Agrega renta, software u otros costos recurrentes.";
    root.appendChild(li);
    return;
  }
  for (const row of fixedExpensesCache) {
    root.appendChild(buildFixedRow(row));
  }
}

function closeFixedModal() {
  const host = document.getElementById("fin-fixed-modal-host");
  if (!host) return;
  host.hidden = true;
  host.setAttribute("aria-hidden", "true");
  document.body.classList.remove("fin-modal-open");
}

/**
 * @param {string | null} [editId]
 */
function openFixedModal(editId = null) {
  closeModal();
  const host = document.getElementById("fin-fixed-modal-host");
  if (!host) return;
  const idInput = document.getElementById("fin-fixed-edit-id");
  const nameI = /** @type {HTMLInputElement | null} */ (document.getElementById("fin-fixed-name"));
  const amtI = /** @type {HTMLInputElement | null} */ (document.getElementById("fin-fixed-amount"));
  const freq = /** @type {HTMLSelectElement | null} */ (document.getElementById("fin-fixed-frequency"));
  const act = /** @type {HTMLInputElement | null} */ (document.getElementById("fin-fixed-active"));
  const title = document.getElementById("fin-fixed-modal-title");
  if (editId) {
    const row = fixedExpensesCache.find((x) => x.id === editId);
    if (idInput) idInput.value = editId;
    if (nameI) nameI.value = row?.name || "";
    if (amtI) amtI.value = row && Number.isFinite(row.amount) ? String(row.amount) : "";
    if (freq) freq.value = "monthly";
    if (act) act.checked = row ? row.active : true;
    if (title) title.textContent = "Editar gasto fijo";
  } else {
    if (idInput) idInput.value = "";
    if (nameI) nameI.value = "";
    if (amtI) amtI.value = "";
    if (freq) freq.value = "monthly";
    if (act) act.checked = true;
    if (title) title.textContent = "Nuevo gasto fijo";
  }
  host.hidden = false;
  host.setAttribute("aria-hidden", "false");
  document.body.classList.add("fin-modal-open");
  nameI?.focus();
}

function wireFixedModal() {
  document.getElementById("fin-fixed-add")?.addEventListener("click", () => openFixedModal(null));
  document.getElementById("fin-fixed-modal-cancel")?.addEventListener("click", () => closeFixedModal());
  document.getElementById("fin-fixed-modal-backdrop")?.addEventListener("click", () => closeFixedModal());

  document.getElementById("fin-fixed-modal-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!businessId) return;
    const editId = String(document.getElementById("fin-fixed-edit-id")?.value || "").trim();
    const name = String(document.getElementById("fin-fixed-name")?.value || "").trim();
    const rawAmt = Number(document.getElementById("fin-fixed-amount")?.value);
    const frequency = String(document.getElementById("fin-fixed-frequency")?.value || "monthly");
    const active = Boolean(document.getElementById("fin-fixed-active")?.checked);
    if (!name || !Number.isFinite(rawAmt) || rawAmt <= 0) {
      alert("Indica nombre y un monto válido mayor a cero.");
      return;
    }
    if (frequency !== "monthly") {
      alert("Por ahora solo está disponible la frecuencia mensual.");
      return;
    }
    const saveBtn = document.getElementById("fin-fixed-modal-save");
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.setAttribute("aria-busy", "true");
    }
    try {
      const payload = {
        name,
        amount: rawAmt,
        frequency: "monthly",
        active,
        updatedAt: serverTimestamp(),
      };
      if (editId) {
        await updateDoc(doc(db, "businesses", businessId, "fixedExpenses", editId), payload);
      } else {
        await addDoc(collection(db, "businesses", businessId, "fixedExpenses"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      closeFixedModal();
    } catch (err) {
      console.error(err);
      alert("No se pudo guardar el gasto fijo.");
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.removeAttribute("aria-busy");
      }
    }
  });
}

function subscribeFixedExpenses(bid) {
  if (unsubFixedExpenses) {
    unsubFixedExpenses();
    unsubFixedExpenses = null;
  }
  unsubFixedExpenses = onSnapshot(
    collection(db, "businesses", bid, "fixedExpenses"),
    (snap) => {
      fixedExpensesCache = [];
      snap.forEach((d) => {
        const data = d.data();
        const name = typeof data.name === "string" ? data.name.trim() : "";
        const amount = Number(data.amount);
        const frequency =
          typeof data.frequency === "string" ? data.frequency.trim().toLowerCase() : "monthly";
        const active = data.active !== false;
        fixedExpensesCache.push({
          id: d.id,
          name: name || "Sin nombre",
          amount: Number.isFinite(amount) ? amount : 0,
          frequency,
          active,
        });
      });
      fixedExpensesCache.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
      renderFixedList();
      renderList();
    },
    (err) => {
      console.error(err);
    },
  );
}

function populateCategorySelect(type) {
  const sel = document.getElementById("fin-select-cat");
  if (!sel) return;
  const opts = type === "income" ? INCOME_OPTIONS : EXPENSE_OPTIONS;
  sel.replaceChildren();
  for (const o of opts) {
    const op = document.createElement("option");
    op.value = o.value;
    op.textContent = o.label;
    sel.appendChild(op);
  }
}

function openModal() {
  closeFixedModal();
  const host = document.getElementById("fin-modal-host");
  if (!host) return;
  const typeInp = document.querySelector('input[name="fin-type"]:checked');
  const type = typeInp && typeInp.value === "expense" ? "expense" : "income";
  populateCategorySelect(type);

  const amount = document.getElementById("fin-input-amount");
  const desc = document.getElementById("fin-input-desc");
  const dateInp = document.getElementById("fin-input-date");
  if (amount) amount.value = "";
  if (desc) desc.value = "";
  if (dateInp) {
    const t = new Date();
    dateInp.value = t.toISOString().slice(0, 10);
  }

  host.hidden = false;
  host.setAttribute("aria-hidden", "false");
  document.body.classList.add("fin-modal-open");
  amount?.focus();
}

function closeModal() {
  const host = document.getElementById("fin-modal-host");
  if (!host) return;
  host.hidden = true;
  host.setAttribute("aria-hidden", "true");
  document.body.classList.remove("fin-modal-open");
}

function wireModal() {
  document.getElementById("fin-fab-open")?.addEventListener("click", () => openModal());
  document.getElementById("fin-modal-cancel")?.addEventListener("click", () => closeModal());
  document.getElementById("fin-modal-backdrop")?.addEventListener("click", () => closeModal());

  document.querySelectorAll('input[name="fin-type"]').forEach((el) => {
    el.addEventListener("change", () => {
      const t = /** @type {HTMLInputElement} */ (el).value === "expense" ? "expense" : "income";
      populateCategorySelect(t);
    });
  });

  document.getElementById("fin-modal-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!businessId) return;
    const typeEl = document.querySelector('input[name="fin-type"]:checked');
    const type = typeEl && typeEl.value === "expense" ? "expense" : "income";
    const amountEl = document.getElementById("fin-input-amount");
    const descEl = document.getElementById("fin-input-desc");
    const catEl = document.getElementById("fin-select-cat");
    const dateEl = document.getElementById("fin-input-date");
    const raw = amountEl && "value" in amountEl ? Number(amountEl.value) : NaN;
    if (!Number.isFinite(raw) || raw <= 0) {
      alert("Indica un monto válido mayor a cero.");
      return;
    }
    const description = descEl && "value" in descEl ? String(descEl.value).trim() : "";
    const category = catEl && "value" in catEl ? String(catEl.value).trim() : "";
    const dateStr = dateEl && "value" in dateEl ? String(dateEl.value) : "";
    if (!description || !category || !dateStr) {
      alert("Completa categoría, descripción y fecha.");
      return;
    }

    const d = new Date(`${dateStr}T12:00:00`);
    if (Number.isNaN(d.getTime())) {
      alert("Fecha no válida.");
      return;
    }

    const saveBtn = document.getElementById("fin-modal-save");
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.setAttribute("aria-busy", "true");
    }
    try {
      await addDoc(collection(db, "businesses", businessId, "finance"), {
        type,
        amount: raw,
        category,
        description,
        clientId: null,
        orderId: null,
        status: "cobrado",
        createdAt: serverTimestamp(),
        createdBy: "marvin",
        date: Timestamp.fromDate(d),
      });
      closeModal();
    } catch (err) {
      console.error(err);
      alert("No se pudo guardar el movimiento.");
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.removeAttribute("aria-busy");
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !document.body.classList.contains("fin-modal-open")) return;
    const fixedHost = document.getElementById("fin-fixed-modal-host");
    if (fixedHost && !fixedHost.hidden) {
      closeFixedModal();
      return;
    }
    closeModal();
  });
}

function wireFilters() {
  document.querySelectorAll("[data-fin-period]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = /** @type {HTMLElement} */ (btn).getAttribute("data-fin-period");
      if (p !== "today" && p !== "week" && p !== "month" && p !== "all") return;
      currentPeriod = p;
      document.querySelectorAll(".fin-filter-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      renderList();
    });
  });
}

function subscribeFinance(bid) {
  if (unsubFinance) {
    unsubFinance();
    unsubFinance = null;
  }
  businessId = bid;
  const qy = query(
    collection(db, "businesses", bid, "finance"),
    orderBy("date", "desc"),
    limit(500),
  );
  unsubFinance = onSnapshot(
    qy,
    (snap) => {
      rowsCache = [];
      snap.forEach((d) => {
        const data = d.data();
        const amount = Number(data.amount);
        const type = data.type === "expense" ? "expense" : "income";
        const date = tsToDate(data.date) || tsToDate(data.createdAt);
        rowsCache.push({
          id: d.id,
          type,
          amount: Number.isFinite(amount) ? amount : 0,
          category: typeof data.category === "string" ? data.category : "",
          description: typeof data.description === "string" ? data.description : "",
          date,
          createdBy: typeof data.createdBy === "string" ? data.createdBy : undefined,
          status: typeof data.status === "string" ? data.status : "",
        });
      });
      console.log("[FINANZAS_LOAD]", rowsCache.length, "movimientos");
      renderList();
    },
    (err) => {
      console.error(err);
      showLoadError("No se pudieron cargar los movimientos. Revisa tu conexión o permisos.");
    },
  );
}

async function bootUser(user) {
  hideLoadError();
  const business = await resolveBusinessForUser(db, user);
  renderHeader(business);
  yourColorFinMode = isYourColorFinanceBusiness(business);
  const fixedPanel = document.getElementById("fin-fixed-panel");
  if (fixedPanel) fixedPanel.hidden = !yourColorFinMode;

  if (!business) {
    businessId = null;
    rowsCache = [];
    fixedExpensesCache = [];
    yourColorFinMode = false;
    if (fixedPanel) fixedPanel.hidden = true;
    if (unsubFinance) unsubFinance();
    unsubFinance = null;
    if (unsubFixedExpenses) unsubFixedExpenses();
    unsubFixedExpenses = null;
    const root = document.getElementById("fin-list-root");
    if (root) {
      root.innerHTML = '<p class="fin-empty">No hay negocio asociado a tu cuenta.</p>';
    }
    renderFixedList();
    return;
  }
  subscribeFinance(business.id);
  if (yourColorFinMode) {
    subscribeFixedExpenses(business.id);
  } else {
    if (unsubFixedExpenses) unsubFixedExpenses();
    unsubFixedExpenses = null;
    fixedExpensesCache = [];
    renderFixedList();
    renderList();
  }
}

function boot() {
  initDashShell({ auth, db });
  wireFilters();
  wireFixedModal();
  wireModal();

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    bootUser(user).catch((err) => {
      console.error(err);
      showLoadError("Error al cargar Finanzas.");
    });
  });
}

boot();

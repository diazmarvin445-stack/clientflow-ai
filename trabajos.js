import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  addDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { resolveBusinessForUser, formatBusinessMeta, initialsFromName } from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";
import { businessCollectionRef, businessDocRef } from "./category-context.js";

let businessId = "";
let userId = "";
let allJobs = [];
let clients = [];

const els = {
  tbody: document.getElementById("jobs-tbody"),
  addBtn: document.getElementById("jobs-btn-add"),
  modal: document.getElementById("jobs-modal"),
  form: document.getElementById("jobs-form"),
  cancel: document.getElementById("jobs-btn-cancel"),
  statusFilter: document.getElementById("jobs-filter-status"),
  search: document.getElementById("jobs-filter-search"),
};

function money(v) {
  return `$${(Number(v) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function fmtDate(v) {
  const d = toDate(v);
  return d ? d.toLocaleDateString("es") : "—";
}
function renderHeader(business) {
  const nameEl = document.getElementById("dash-business-name");
  const metaEl = document.getElementById("dash-business-meta");
  const av = document.getElementById("dash-avatar-initials");
  if (!business) return;
  const displayName = (business.data?.businessName || "Tu negocio").trim();
  const { metaLine } = formatBusinessMeta(business.data);
  if (nameEl) nameEl.textContent = displayName;
  if (metaEl) metaEl.textContent = metaLine;
  if (av) av.textContent = initialsFromName(displayName);
}

function computeProfit(job) {
  return (Number(job.totalCharged) || 0) - (Number(job.totalCost) || 0);
}

function updateSummary(rows) {
  const active = rows.filter((j) => j.status === "in_progress").length;
  const pending = rows.filter((j) => j.status === "pending").length;
  const completed = rows.filter((j) => j.status === "completed" || j.status === "paid").length;
  const profit = rows.reduce((sum, j) => sum + computeProfit(j), 0);
  document.getElementById("jobs-metric-active").textContent = String(active);
  document.getElementById("jobs-metric-pending").textContent = String(pending);
  document.getElementById("jobs-metric-completed").textContent = String(completed);
  document.getElementById("jobs-metric-profit").textContent = money(profit);
}

function statusClass(status) {
  if (status === "paid") return "dash-badge--done";
  if (status === "completed") return "dash-badge--sched";
  if (status === "in_progress") return "dash-badge--prog";
  return "dash-badge--cancelled";
}

function applyFilters() {
  const status = els.statusFilter?.value || "all";
  const q = (els.search?.value || "").trim().toLowerCase();
  let rows = [...allJobs];
  if (status !== "all") rows = rows.filter((r) => String(r.status) === status);
  if (q) {
    rows = rows.filter((r) =>
      `${r.clientName || ""} ${r.jobType || ""} ${r.location || ""}`.toLowerCase().includes(q),
    );
  }
  renderRows(rows);
  updateSummary(rows);
}

function openModal(row = null) {
  document.getElementById("jobs-id").value = row?.id || "";
  document.getElementById("jobs-client-id").value = row?.clientId || "";
  document.getElementById("jobs-client-name").value = row?.clientName || "";
  document.getElementById("jobs-type").value = row?.jobType || "";
  document.getElementById("jobs-location").value = row?.location || "";
  document.getElementById("jobs-start").value = row?.startDate || "";
  document.getElementById("jobs-end-est").value = row?.estimatedEndDate || "";
  document.getElementById("jobs-status").value = row?.status || "pending";
  document.getElementById("jobs-team").value = Array.isArray(row?.assignedTeam) ? row.assignedTeam.join(", ") : "";
  document.getElementById("jobs-materials").value = Array.isArray(row?.materialsUsed) ? row.materialsUsed.join(", ") : "";
  document.getElementById("jobs-total-cost").value = row?.totalCost ?? "";
  document.getElementById("jobs-total-charged").value = row?.totalCharged ?? "";
  document.getElementById("jobs-notes").value = row?.notes || "";
  els.modal?.showModal();
}

function closeModal() {
  els.modal?.close();
}

async function addFinanceExpenseForMaterials(uid, bid, jobId, amount, jobType) {
  if (amount <= 0) return;
  await addDoc(businessCollectionRef(db, uid, bid, "finances"), {
    type: "expense",
    amount,
    category: "materiales",
    description: `Materiales trabajo: ${jobType || jobId}`,
    source: "job-auto",
    jobId,
    date: new Date(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

async function addFinanceIncomeForCompletedJob(uid, bid, jobId, amount, jobType) {
  if (amount <= 0) return;
  await addDoc(businessCollectionRef(db, uid, bid, "finances"), {
    type: "income",
    amount,
    category: "ventas",
    description: `Trabajo completado: ${jobType || jobId}`,
    source: "job-auto",
    jobId,
    date: new Date(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

async function saveJob(ev) {
  ev.preventDefault();
  if (!businessId) return;
  const id = document.getElementById("jobs-id").value.trim();
  const clientId = document.getElementById("jobs-client-id").value.trim();
  const clientNameFallback = document.getElementById("jobs-client-name").value.trim();
  const pickedClient = clients.find((c) => c.id === clientId);
  const status = document.getElementById("jobs-status").value;
  const totalCost = Number(document.getElementById("jobs-total-cost").value || 0);
  const totalCharged = Number(document.getElementById("jobs-total-charged").value || 0);
  const payload = {
    clientId: clientId || null,
    clientName: pickedClient?.fullName || pickedClient?.name || clientNameFallback || "Cliente",
    jobType: document.getElementById("jobs-type").value.trim(),
    location: document.getElementById("jobs-location").value.trim(),
    startDate: document.getElementById("jobs-start").value || null,
    estimatedEndDate: document.getElementById("jobs-end-est").value || null,
    status,
    assignedTeam: document
      .getElementById("jobs-team")
      .value.split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    materialsUsed: document
      .getElementById("jobs-materials")
      .value.split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    totalCost,
    totalCharged,
    profit: totalCharged - totalCost,
    notes: document.getElementById("jobs-notes").value.trim(),
    updatedAt: serverTimestamp(),
  };

  if (!id) {
    const ref = await addDoc(businessCollectionRef(db, userId, businessId, "jobs"), {
      ...payload,
      createdAt: serverTimestamp(),
    });
    if (totalCost > 0) await addFinanceExpenseForMaterials(userId, businessId, ref.id, totalCost, payload.jobType);
    if (status === "completed" || status === "paid") {
      await addFinanceIncomeForCompletedJob(userId, businessId, ref.id, totalCharged, payload.jobType);
    }
  } else {
    const prev = allJobs.find((j) => j.id === id) || {};
    await updateDoc(businessDocRef(db, userId, businessId, "jobs", id), payload);
    const deltaCost = totalCost - (Number(prev.totalCost) || 0);
    if (deltaCost > 0) await addFinanceExpenseForMaterials(userId, businessId, id, deltaCost, payload.jobType);
    const wasCompleted = prev.status === "completed" || prev.status === "paid";
    const nowCompleted = status === "completed" || status === "paid";
    if (!wasCompleted && nowCompleted) {
      await addFinanceIncomeForCompletedJob(userId, businessId, id, totalCharged, payload.jobType);
    }
  }
  closeModal();
}

async function removeJob(id) {
  if (!businessId || !id) return;
  if (!window.confirm("¿Eliminar este trabajo?")) return;
  await deleteDoc(businessDocRef(db, userId, businessId, "jobs", id));
}

function renderRows(rows) {
  if (!els.tbody) return;
  els.tbody.innerHTML = "";
  rows.forEach((job) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${job.clientName || "—"}</td>
      <td><strong>${job.jobType || "—"}</strong></td>
      <td>${job.location || "—"}</td>
      <td>Inicio: ${fmtDate(job.startDate)}<br>Fin est.: ${fmtDate(job.estimatedEndDate)}</td>
      <td><span class="dash-badge ${statusClass(job.status)}">${job.status || "pending"}</span></td>
      <td>${Array.isArray(job.assignedTeam) ? job.assignedTeam.join(", ") : "—"}</td>
      <td>Costo ${money(job.totalCost)}<br>Cobrado ${money(job.totalCharged)}<br>Profit ${money(computeProfit(job))}</td>
      <td>
        <button type="button" class="dash-icon-btn" data-edit="${job.id}" aria-label="Editar">✏️</button>
        <button type="button" class="dash-icon-btn" data-del="${job.id}" aria-label="Borrar">🗑️</button>
      </td>
    `;
    els.tbody.appendChild(tr);
  });
  els.tbody.querySelectorAll("[data-edit]").forEach((b) => {
    b.addEventListener("click", () => openModal(allJobs.find((j) => j.id === b.getAttribute("data-edit")) || null));
  });
  els.tbody.querySelectorAll("[data-del]").forEach((b) => {
    b.addEventListener("click", () => removeJob(b.getAttribute("data-del")));
  });
}

function fillClientSelect() {
  const sel = document.getElementById("jobs-client-id");
  if (!sel) return;
  sel.innerHTML = `<option value="">Seleccionar cliente</option>`;
  clients.forEach((c) => {
    const op = document.createElement("option");
    op.value = c.id;
    op.textContent = c.fullName || c.name || c.id;
    sel.appendChild(op);
  });
}

async function loadClients() {
  const snap = await getDocs(businessCollectionRef(db, userId, businessId, "clients"));
  clients = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  fillClientSelect();
}

async function loadPage(user) {
  const business = await resolveBusinessForUser(db, user);
  if (!business) return;
  businessId = business.id;
  userId = business?.scope?.uid || user.uid;
  renderHeader(business);
  await loadClients();
  onSnapshot(
    query(businessCollectionRef(db, userId, businessId, "jobs"), orderBy("createdAt", "desc")),
    (snap) => {
    allJobs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    applyFilters();
    },
  );
}

function boot() {
  initDashShell({ auth, db });
  els.addBtn?.addEventListener("click", () => openModal());
  els.cancel?.addEventListener("click", closeModal);
  els.form?.addEventListener("submit", saveJob);
  els.statusFilter?.addEventListener("change", applyFilters);
  els.search?.addEventListener("input", applyFilters);
  onAuthStateChanged(auth, (user) => {
    if (!user) return window.location.replace("login.html");
    loadPage(user).catch((e) => console.error("[trabajos]", e));
  });
}

boot();

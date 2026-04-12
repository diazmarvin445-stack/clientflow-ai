/**
 * Firestore reads for the business dashboard (modular, reusable).
 * Expected document shapes are documented inline; extend as the app grows.
 */
import {
  collection,
  getDocs,
  query,
  where,
  limit,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

/**
 * Align Firestore shapes with onboarding (`onboarding.js`): businessName, services[], serviceArea, etc.
 * Handles occasional map/string variants so UI modules never throw on missing arrays.
 */
export function normalizeBusinessDocument(raw) {
  if (!raw || typeof raw !== "object") return {};

  let services = raw.services;
  if (!Array.isArray(services)) {
    if (services && typeof services === "object") {
      services = Object.values(services);
    } else if (typeof services === "string" && services.trim()) {
      services = [services.trim()];
    } else {
      services = [];
    }
  }

  return {
    ...raw,
    services,
    businessName:
      (typeof raw.businessName === "string" && raw.businessName.trim()) ||
      (typeof raw.name === "string" && raw.name.trim()) ||
      "",
    businessDescription:
      (typeof raw.businessDescription === "string" && raw.businessDescription) ||
      (typeof raw.description === "string" && raw.description) ||
      "",
    serviceArea:
      (typeof raw.serviceArea === "string" && raw.serviceArea) ||
      (typeof raw.area === "string" && raw.area) ||
      "",
    serviceOtherDetail:
      typeof raw.serviceOtherDetail === "string" ? raw.serviceOtherDetail : "",
  };
}

export async function fetchBusinessForOwner(db, ownerUid) {
  const q = query(collection(db, "businesses"), where("ownerUid", "==", ownerUid), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { id: docSnap.id, data: normalizeBusinessDocument(docSnap.data()) };
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  return new Date(value);
}

function startOfLocalDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfLocalDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * Aggregates metrics from subcollections. Works without composite indexes
 * by reading documents and filtering in memory (fine for early-stage volume).
 *
 * Jobs: use `status === "confirmed"` and numeric `amount` (fallback `estimatedAmount`).
 * Campaigns: `status === "active"`.
 * Leads: `createdAt` Firestore Timestamp or Date for "today" filter.
 */
/**
 * IDs of AI recommendations already saved as active campaigns (`recommendationId` on campaign docs).
 */
export async function fetchLaunchedRecommendationIds(db, businessId) {
  const snap = await getDocs(collection(db, "businesses", businessId, "campaigns"));
  const ids = new Set();
  snap.forEach((docSnap) => {
    const row = docSnap.data();
    if (row && row.status === "active" && typeof row.recommendationId === "string") {
      ids.add(row.recommendationId);
    }
  });
  return ids;
}

export async function fetchDashboardMetrics(db, businessId) {
  const [leadsSnap, jobsSnap, campaignsSnap] = await Promise.all([
    getDocs(collection(db, "businesses", businessId, "leads")),
    getDocs(collection(db, "businesses", businessId, "jobs")),
    getDocs(collection(db, "businesses", businessId, "campaigns")),
  ]);

  const todayStart = startOfLocalDay();
  const todayEnd = endOfLocalDay();
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const yesterdayEnd = new Date(todayStart);
  yesterdayEnd.setMilliseconds(-1);

  let leadsToday = 0;
  let leadsYesterday = 0;
  const recentLeadDocs = [];

  /** Solicitudes públicas (`solicitar.html`) → `businesses/{businessId}/leads` (customerName, service, status, createdAt, …) */
  leadsSnap.forEach((doc) => {
    const row = doc.data();
    const created = toDate(row.createdAt);
    if (created && created >= todayStart && created <= todayEnd) {
      leadsToday += 1;
    }
    if (created && created >= yesterdayStart && created <= yesterdayEnd) {
      leadsYesterday += 1;
    }
    recentLeadDocs.push({ ...row, id: doc.id });
  });

  recentLeadDocs.sort((a, b) => {
    const ta = toDate(a.createdAt)?.getTime() ?? 0;
    const tb = toDate(b.createdAt)?.getTime() ?? 0;
    return tb - ta;
  });

  let jobsConfirmed = 0;
  let revenueSum = 0;
  jobsSnap.forEach((doc) => {
    const row = doc.data();
    if (row.status === "confirmed") {
      jobsConfirmed += 1;
      const amt = Number(row.amount ?? row.estimatedAmount ?? 0);
      if (!Number.isNaN(amt)) revenueSum += amt;
    }
  });

  let campaignsActive = 0;
  campaignsSnap.forEach((doc) => {
    const row = doc.data();
    if (row.status === "active") campaignsActive += 1;
  });

  return {
    leadsToday,
    leadsYesterday,
    jobsConfirmed,
    revenueSum,
    campaignsActive,
    /** Todas las solicitudes, más recientes primero (misma colección que `solicitar.html?businessId=`) */
    recentLeads: recentLeadDocs,
  };
}

export const SERVICE_LABELS = {
  "lawn-care": "Lawn Care",
  landscaping: "Landscaping",
  "tree-removal": "Tree Removal",
  "pressure-washing": "Pressure Washing",
  other: "Other",
};

export function formatBusinessMeta(businessData) {
  if (!businessData || typeof businessData !== "object") {
    return { plan: "Plan Pro", serviceLine: "Servicio local", metaLine: "Plan Pro · Servicio local" };
  }

  const plan =
    (typeof businessData.planName === "string" && businessData.planName.trim()) ||
    (typeof businessData.plan === "string" && businessData.plan.trim()) ||
    "Plan Pro";

  let serviceLine = "";
  if (typeof businessData.serviceType === "string" && businessData.serviceType.trim()) {
    serviceLine = businessData.serviceType.trim();
  } else if (Array.isArray(businessData.services) && businessData.services.length) {
    serviceLine = businessData.services
      .map((s) => SERVICE_LABELS[s] || s)
      .slice(0, 4)
      .join(", ");
  } else {
    serviceLine = "Servicio local";
  }

  return { plan, serviceLine, metaLine: `${plan} · ${serviceLine}` };
}

export function initialsFromName(name) {
  if (!name || typeof name !== "string") return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const STATUS_BADGE = {
  new: { className: "dash-badge--new", label: "Nuevo" },
  nuevo: { className: "dash-badge--new", label: "Nuevo" },
  in_progress: { className: "dash-badge--prog", label: "En curso" },
  progress: { className: "dash-badge--prog", label: "En curso" },
  quote: { className: "dash-badge--quote", label: "Presupuesto" },
  presupuesto: { className: "dash-badge--quote", label: "Presupuesto" },
  confirmed: { className: "dash-badge--done", label: "Confirmado" },
  confirmado: { className: "dash-badge--done", label: "Confirmado" },
};

export function leadStatusPresentation(status) {
  const key = typeof status === "string" ? status.toLowerCase() : "";
  if (STATUS_BADGE[key]) return STATUS_BADGE[key];
  return { className: "dash-badge--new", label: status ? String(status) : "—" };
}

export function formatShortDate(value, locale = "es") {
  const d = toDate(value);
  if (!d || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Renders lead rows into a `<tbody>`. Clears existing rows.
 * @param {HTMLTableSectionElement | null} tbody
 * @param {Array<Record<string, unknown> & { id?: string }>} leads
 * @param {{ emptyState?: 'simple' | 'dashboard' }} [opts]
 */
export function renderLeadsTbody(tbody, leads, opts = {}) {
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!leads.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    if (opts.emptyState === "dashboard") {
      td.className = "dash-leads-empty-cell";
      const wrap = document.createElement("div");
      wrap.className = "dash-leads-empty";
      wrap.innerHTML =
        '<div class="dash-leads-empty-icon" aria-hidden="true"></div>' +
        '<p class="dash-leads-empty-title">Aún no tienes solicitudes.</p>' +
        '<p class="dash-leads-empty-text">Cuando lleguen nuevos leads aparecerán aquí.</p>';
      td.appendChild(wrap);
    } else {
      td.className = "dash-table-muted";
      td.textContent = "Sin solicitudes aún";
    }
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  leads.forEach((lead) => {
    const tr = document.createElement("tr");
    const client =
      lead.customerName || lead.clientName || lead.name || lead.contactName || "—";
    const rawSvc = lead.service || lead.serviceLabel || lead.serviceType || "";
    const service = rawSvc ? SERVICE_LABELS[rawSvc] || rawSvc : "—";
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

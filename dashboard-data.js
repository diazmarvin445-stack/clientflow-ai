/**
 * Firestore reads for the business dashboard (modular, reusable).
 * Expected document shapes are documented inline; extend as the app grows.
 */
import {
  collection,
  getDocs,
  query,
  where,
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

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  return new Date(value);
}

/**
 * Owner may have more than one `businesses` doc (e.g. repeated onboarding). `limit(1)` was
 * non-deterministic — Dashboard/Solicitudes could read a different doc than the one used in
 * `solicitar.html?businessId=…`, so leads looked “missing”. We always prefer the newest by `createdAt`.
 */
export async function fetchBusinessForOwner(db, ownerUid) {
  const q = query(collection(db, "businesses"), where("ownerUid", "==", ownerUid));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const rows = snap.docs.map((d) => ({ id: d.id, raw: d.data() }));
  rows.sort((a, b) => {
    const ta = toDate(a.raw.createdAt)?.getTime() ?? 0;
    const tb = toDate(b.raw.createdAt)?.getTime() ?? 0;
    return tb - ta;
  });
  const best = rows[0];
  if (rows.length > 1) {
    console.warn(
      `[ClientFlow] fetchBusinessForOwner: ${rows.length} business(es) for uid; using id=${best.id} (latest createdAt). Leads must use solicitar.html?businessId=${best.id} to match.`,
    );
  } else {
    console.log(
      `[ClientFlow] fetchBusinessForOwner: businesses/${best.id} (reads leads/clients from this doc id)`,
    );
  }
  return { id: best.id, data: normalizeBusinessDocument(best.raw) };
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

/**
 * @param {string | null} [ownerUidForMergedLeads] If set, merges leads from ALL `businesses` docs with this owner (fixes mismatched solicitar `businessId` vs newest `fetchBusinessForOwner` id).
 */
export async function fetchDashboardMetrics(db, businessId, ownerUidForMergedLeads = null) {
  const [jobsSnap, campaignsSnap, recentLeadDocs] = await Promise.all([
    getDocs(collection(db, "businesses", businessId, "jobs")),
    getDocs(collection(db, "businesses", businessId, "campaigns")),
    fetchLeadsForBusiness(db, businessId, ownerUidForMergedLeads || undefined),
  ]);

  const todayStart = startOfLocalDay();
  const todayEnd = endOfLocalDay();
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const yesterdayEnd = new Date(todayStart);
  yesterdayEnd.setMilliseconds(-1);

  let leadsToday = 0;
  let leadsYesterday = 0;

  for (const row of recentLeadDocs) {
    const created = toDate(row.createdAt);
    if (created && created >= todayStart && created <= todayEnd) {
      leadsToday += 1;
    }
    if (created && created >= yesterdayStart && created <= yesterdayEnd) {
      leadsYesterday += 1;
    }
  }

  console.log(
    `[ClientFlow] fetchDashboardMetrics: businessId=${businessId} mergedOwnerUid=${ownerUidForMergedLeads || "(single path)"} recentLeads count=${recentLeadDocs.length}`,
  );

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
  const activeCampaignRows = [];
  campaignsSnap.forEach((doc) => {
    const row = doc.data();
    if (row.status === "active") {
      campaignsActive += 1;
      activeCampaignRows.push({ id: doc.id, data: row });
    }
  });

  activeCampaignRows.sort((a, b) => {
    const ta = toDate(a.data.createdAt)?.getTime() ?? 0;
    const tb = toDate(b.data.createdAt)?.getTime() ?? 0;
    return tb - ta;
  });

  /** Vista compacta de la campaña activa más reciente (panel ejecutivo). */
  let activeCampaignSnapshot = null;
  if (activeCampaignRows.length) {
    const row = activeCampaignRows[0].data;
    const leadsW = Number(row.estimatedLeads);
    const leadsWeeklyEst = Number.isFinite(leadsW) && leadsW >= 0 ? Math.round(leadsW) : 0;
    const reachRaw = Number(row.estimatedReach);
    const usesHeuristicReach = !(Number.isFinite(reachRaw) && reachRaw > 0);
    const reachEstimate = usesHeuristicReach
      ? Math.max(160, Math.round(leadsWeeklyEst * 36))
      : Math.round(reachRaw);
    const clicksRaw = Number(row.clicks);
    const clicks =
      Number.isFinite(clicksRaw) && clicksRaw >= 0 ? Math.round(clicksRaw) : null;

    const plat = typeof row.platform === "string" ? row.platform.toLowerCase() : "";
    let platformLabel = "Facebook";
    if (plat === "instagram") platformLabel = "Instagram";
    else if (plat === "google") platformLabel = "Google Ads";

    const title =
      typeof row.title === "string" && row.title.trim() ? row.title.trim() : "Campaña activa";

    activeCampaignSnapshot = {
      title,
      platform: platformLabel,
      reachEstimate,
      clicks,
      leadsWeeklyEst,
      usesHeuristicReach,
    };
  }

  return {
    leadsToday,
    leadsYesterday,
    jobsConfirmed,
    revenueSum,
    campaignsActive,
    activeCampaignSnapshot,
    /** Todas las solicitudes, más recientes primero (misma colección que `solicitar.html?businessId=`) */
    recentLeads: recentLeadDocs,
  };
}

/**
 * All leads under `businesses/{businessId}/leads` (or every owned business if `ownerUidMerge` is set).
 * Each row includes `_cfBusinessId` for writes (Solicitudes) when multiple tenant docs exist.
 * Newest `createdAt` first.
 */
export async function fetchLeadsForBusiness(db, businessId, ownerUidMerge) {
  let ids;
  if (ownerUidMerge) {
    const snap = await getDocs(
      query(collection(db, "businesses"), where("ownerUid", "==", ownerUidMerge)),
    );
    ids = snap.docs.map((d) => d.id);
  } else {
    ids = businessId ? [businessId] : [];
  }
  if (!ids.length) {
    console.log("[ClientFlow] fetchLeadsForBusiness: no business id(s), count=0");
    return [];
  }

  const snaps = await Promise.all(
    ids.map((bid) => getDocs(collection(db, "businesses", bid, "leads"))),
  );
  const rows = [];
  snaps.forEach((leadSnap, idx) => {
    const bid = ids[idx];
    leadSnap.forEach((docSnap) => {
      rows.push({ id: docSnap.id, _cfBusinessId: bid, ...docSnap.data() });
    });
  });
  rows.sort((a, b) => {
    const ta = toDate(a.createdAt)?.getTime() ?? 0;
    const tb = toDate(b.createdAt)?.getTime() ?? 0;
    return tb - ta;
  });
  console.log(
    `[ClientFlow] fetchLeadsForBusiness: paths ${ids.map((id) => `businesses/${id}/leads`).join(", ")} → count=${rows.length}`,
  );
  return rows;
}

/**
 * Clients in `businesses/{businessId}/clients`, newest `createdAt` first.
 */
export async function fetchClientsForBusiness(db, businessId) {
  const snap = await getDocs(collection(db, "businesses", businessId, "clients"));
  const rows = [];
  snap.forEach((docSnap) => {
    rows.push({ id: docSnap.id, ...docSnap.data() });
  });
  rows.sort((a, b) => {
    const ta = toDate(a.createdAt)?.getTime() ?? 0;
    const tb = toDate(b.createdAt)?.getTime() ?? 0;
    return tb - ta;
  });
  return rows;
}

/**
 * Staff / team members in `businesses/{businessId}/teamMembers`, newest `createdAt` first.
 * Operational fields: fullName, roleTitle, staffCategory, phone, email, active, workDays[], hoursFrom, hoursTo.
 */
export async function fetchTeamMembersForBusiness(db, businessId) {
  const snap = await getDocs(collection(db, "businesses", businessId, "teamMembers"));
  const rows = [];
  snap.forEach((docSnap) => {
    rows.push({ id: docSnap.id, ...docSnap.data() });
  });
  rows.sort((a, b) => {
    const ta = toDate(a.createdAt)?.getTime() ?? 0;
    const tb = toDate(b.createdAt)?.getTime() ?? 0;
    return tb - ta;
  });
  console.log(
    `[ClientFlow] fetchTeamMembersForBusiness: businesses/${businessId}/teamMembers → ${rows.length} document(s)`,
  );
  return rows;
}

/**
 * Display label for campaign `platform` (Facebook / Instagram / Google Ads).
 */
export function campaignPlatformDisplayName(raw) {
  const p = typeof raw === "string" ? raw.toLowerCase() : "";
  if (p === "instagram") return "Instagram";
  if (p === "google") return "Google Ads";
  return "Facebook";
}

/**
 * All campaigns under `businesses/{businessId}/campaigns` plus aggregate KPIs for the hub.
 */
export async function fetchCampaignsListAndStats(db, businessId) {
  const snap = await getDocs(collection(db, "businesses", businessId, "campaigns"));
  const list = [];
  snap.forEach((d) => {
    list.push({ id: d.id, ...d.data() });
  });
  list.sort((a, b) => {
    const ta = toDate(a.createdAt)?.getTime() ?? 0;
    const tb = toDate(b.createdAt)?.getTime() ?? 0;
    return tb - ta;
  });

  let activeCount = 0;
  let totalLeads = 0;
  let totalReach = 0;
  let totalConv = 0;

  for (const row of list) {
    const st = String(row.status || "").toLowerCase();
    if (st === "active") activeCount += 1;

    const el = Number(row.estimatedLeads);
    const leadsPart = Number.isFinite(el) && el >= 0 ? Math.round(el) : 0;
    totalLeads += leadsPart;

    const er = Number(row.estimatedReach);
    if (Number.isFinite(er) && er > 0) totalReach += Math.round(er);
    else totalReach += Math.max(160, Math.round(leadsPart * 36));

    const conv = Number(row.conversions);
    const clk = Number(row.clicks);
    if (Number.isFinite(conv) && conv >= 0) totalConv += Math.round(conv);
    else if (Number.isFinite(clk) && clk >= 0) totalConv += Math.round(clk);
  }

  if (totalConv === 0 && totalLeads > 0) {
    totalConv = Math.max(1, Math.round(totalLeads * 0.1));
  }

  return {
    activeCount,
    totalLeads,
    totalReach,
    totalConversions: totalConv,
    campaigns: list,
  };
}

/**
 * Fields for `addDoc` to `clients` when converting a lead (timestamps added by caller).
 */
export function buildClientPayloadFromLead(lead) {
  const fullName =
    (lead.customerName && String(lead.customerName).trim()) ||
    (lead.clientName && String(lead.clientName).trim()) ||
    (lead.name && String(lead.name).trim()) ||
    "Cliente";
  const phone = typeof lead.phone === "string" ? lead.phone.trim() : "";
  const address = typeof lead.address === "string" ? lead.address.trim() : "";
  const primaryService = typeof lead.service === "string" ? lead.service.trim() : "";
  const notes = typeof lead.notes === "string" ? lead.notes : "";
  const payload = {
    fullName,
    phone,
    address,
    primaryService,
    notes,
    sourceLeadId: typeof lead.id === "string" ? lead.id : String(lead.id || ""),
  };

  const desc = typeof lead.description === "string" ? lead.description.trim() : "";
  if (desc) {
    payload.description = desc;
  }

  const estimated = Number(lead.estimatedPrice);
  if (Number.isFinite(estimated)) {
    payload.estimatedPrice = estimated;
    if (estimated > 0) {
      payload.totalValue = estimated;
    }
  }

  if (lead.createdAt != null) {
    payload.createdAt = lead.createdAt;
  }

  return payload;
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

/** Maps legacy / alternate labels to canonical Firestore `status` values. */
const LEGACY_STATUS_TO_CANONICAL = {
  "": "new",
  new: "new",
  nuevo: "new",
  contacted: "contacted",
  contactado: "contacted",
  quoted: "quoted",
  quote: "quoted",
  presupuesto: "quoted",
  scheduled: "scheduled",
  programado: "scheduled",
  confirmed: "scheduled",
  confirmado: "scheduled",
  completed: "completed",
  completado: "completed",
  won: "completed",
  ganado: "completed",
  done: "completed",
  lost: "lost",
  perdido: "lost",
  in_progress: "contacted",
  progress: "contacted",
};

const CANONICAL_STATUSES = ["new", "contacted", "quoted", "scheduled", "completed", "lost"];

const STATUS_BADGE = {
  new: { className: "dash-badge--new", label: "Nuevo" },
  contacted: { className: "dash-badge--prog", label: "Contactado" },
  quoted: { className: "dash-badge--quote", label: "Cotización" },
  scheduled: { className: "dash-badge--sched", label: "Programado" },
  completed: { className: "dash-badge--done", label: "Ganado" },
  lost: { className: "dash-badge--lost", label: "Perdido" },
};

/**
 * Normalizes any stored `status` to a canonical CRM value for selects and writes.
 */
export function normalizeLeadStatus(raw) {
  if (raw == null) return "new";
  const key = String(raw).toLowerCase().trim();
  if (Object.prototype.hasOwnProperty.call(LEGACY_STATUS_TO_CANONICAL, key)) {
    return LEGACY_STATUS_TO_CANONICAL[key];
  }
  if (CANONICAL_STATUSES.includes(key)) return key;
  return "new";
}

export function leadStatusPresentation(status) {
  const c = normalizeLeadStatus(status);
  if (STATUS_BADGE[c]) return STATUS_BADGE[c];
  return { className: "dash-badge--new", label: status ? String(status) : "—" };
}

export const LEAD_STATUS_OPTIONS_ES = [
  { value: "new", label: "Nuevo lead" },
  { value: "contacted", label: "Contactado" },
  { value: "quoted", label: "Cotización enviada" },
  { value: "scheduled", label: "Programado" },
  { value: "completed", label: "Ganado" },
  { value: "lost", label: "Perdido" },
];

/**
 * Relative label for lists (Hoy / Ayer / hace N días / fecha).
 */
export function formatLeadRelativeTimeEs(value) {
  const d = toDate(value);
  if (!d || Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const today0 = startOfLocalDay(now);
  const day0 = startOfLocalDay(d);
  const diffDays = Math.round((today0.getTime() - day0.getTime()) / 86400000);
  const timeStr = d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return `Hoy · ${timeStr}`;
  if (diffDays === 1) return `Ayer · ${timeStr}`;
  if (diffDays > 1 && diffDays < 7) return `Hace ${diffDays} días`;
  return d.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
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

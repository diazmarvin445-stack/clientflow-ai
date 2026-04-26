/**
 * Firestore reads for the business dashboard (modular, reusable).
 * Expected document shapes are documented inline; extend as the app grows.
 */
import {
  collection,
  doc,
  getDocs,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  clearActiveCategory,
  resolveCategoryContextForUser,
  setActiveCategoryId,
  listUserCategories,
  loadCategoryProfile,
} from "./category-context.js";

function scopedCategoryCollection(db, businessId, ownerUid, subcollection) {
  if (ownerUid && typeof ownerUid === "string") {
    return collection(db, "users", ownerUid, "categories", businessId, subcollection);
  }
  return collection(db, "businesses", businessId, subcollection);
}

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

/** Service checkbox values from onboarding (shared labels for UI + campaign defaults). */
export const SERVICE_LABELS = {
  "lawn-care": "Lawn Care",
  landscaping: "Landscaping",
  "tree-removal": "Tree Removal",
  "pressure-washing": "Pressure Washing",
  other: "Other",
};

/**
 * Maps Configuración marketing goal (`cfg-mkt-goal`) values to a short campaign objective line.
 * @param {string} [raw]
 */
function mapMarketingGoalToObjective(raw) {
  const g = (typeof raw === "string" ? raw : "leads").toLowerCase().trim();
  if (g === "branding") return "Dar a conocer mi negocio y reforzar marca";
  if (g === "sales") return "Vender más y cerrar oportunidades";
  if (g === "traffic") return "Recibir más llamadas o mensajes";
  return "Conseguir más clientes (leads y solicitudes)";
}

function clipText(s, max) {
  const t = typeof s === "string" ? s.trim() : "";
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trim()}…`;
}

/**
 * Ingresos en `finance`: solo `status` cobrado (o sin status, legado) cuentan como ingreso real del mes.
 * Depósitos retenidos al crear pedido usan status "retenido"; al anularse usan "cancelado".
 * @param {Record<string, unknown>} row
 */
export function financeIncomeCountsTowardRealized(row) {
  if (!row || row.type !== "income") return false;
  const s = String(row.status ?? "cobrado")
    .trim()
    .toLowerCase();
  if (s === "retenido" || s === "cancelado") return false;
  return true;
}

/**
 * Build audience fallback from services checklist + optional "other" service detail.
 * @param {Record<string, unknown>} d normalized business
 */
function buildAudienceHintFromServices(d) {
  const services = Array.isArray(d.services) ? d.services : [];
  const labels = services
    .filter((s) => s !== "other")
    .map((s) => SERVICE_LABELS[s] || s)
    .filter(Boolean);
  const other =
    services.includes("other") && typeof d.serviceOtherDetail === "string" && d.serviceOtherDetail.trim()
      ? d.serviceOtherDetail.trim()
      : "";
  const parts = [...labels, other].filter(Boolean);
  if (!parts.length) return "";
  return `Interesados en: ${parts.slice(0, 5).join(", ")}`;
}

/**
 * Suggested generator field values from the logged-in business profile (onboarding + configuración).
 * Used to prefill the form and to fill gaps when the user leaves a field empty.
 *
 * Sources: `serviceArea`, `marketingMonthlyBudget`, `marketingGoal`, `marketingIdealAudience`,
 * `marketingMainServicesText`, `tagline`, `businessDescription`, `services` / `serviceOtherDetail`, `industry`.
 *
 * @param {Record<string, unknown>} raw Firestore business document (or normalized subset).
 * @returns {{ goal: string, offer: string, location: string, budget: string, audience: string, platformPref: string }}
 */
export function getCampaignGeneratorProfileDefaults(raw) {
  const d = normalizeBusinessDocument(raw || {});

  const location = typeof d.serviceArea === "string" ? d.serviceArea.trim() : "";

  let audience = typeof d.marketingIdealAudience === "string" ? d.marketingIdealAudience.trim() : "";
  if (!audience) {
    audience = buildAudienceHintFromServices(d);
  }
  if (!audience && typeof d.industry === "string" && d.industry.trim()) {
    audience = `Sector: ${d.industry.trim()}`;
  }

  let budgetStr = "";
  const mbRaw = d.marketingMonthlyBudget;
  const mb =
    typeof mbRaw === "number"
      ? mbRaw
      : typeof mbRaw === "string" && mbRaw.trim()
        ? parseFloat(mbRaw.replace(/[^\d.]/g, ""))
        : NaN;
  if (Number.isFinite(mb) && mb > 0) {
    const weeklyUsd = Math.round((mb * 12) / 52);
    budgetStr = String(Math.max(50, Math.min(5000, weeklyUsd)));
  }

  const goal = mapMarketingGoalToObjective(
    typeof d.marketingGoal === "string" ? d.marketingGoal : "leads",
  );

  let offer = "";
  const mst = typeof d.marketingMainServicesText === "string" ? d.marketingMainServicesText.trim() : "";
  const tag = typeof d.tagline === "string" ? d.tagline.trim() : "";
  if (mst) offer = mst;
  else if (tag) offer = tag;
  else if (typeof d.businessDescription === "string" && d.businessDescription.trim()) {
    offer = clipText(d.businessDescription, 160);
  }

  return {
    goal,
    offer,
    location,
    budget: budgetStr,
    audience,
    platformPref: "auto",
  };
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  return new Date(value);
}

const PRIMARY_BUSINESS_SESSION_KEY = "clientflow_primary_business_v1";

/** In-flight coalescing: same-tab concurrent resolves share one Firestore read + one pick. */
const inflightFetchByOwner = new Map();

/** Full user resolution (including email claim) coalesced per uid. */
const inflightResolveByUid = new Map();

/**
 * Clear after sign-out so the next account never inherits another uid’s business id.
 */
export function clearStoredPrimaryBusiness() {
  try {
    sessionStorage.removeItem(PRIMARY_BUSINESS_SESSION_KEY);
  } catch (_) {
    /* ignore */
  }
  clearActiveCategory();
}

/**
 * Call after creating a business (e.g. onboarding) so the session pin matches the new doc
 * before the next navigation. Resolution still re-validates against Firestore rules.
 *
 * @param {string} ownerUid
 * @param {string} businessId
 */
export function setSessionPrimaryBusinessId(ownerUid, businessId) {
  const uid = typeof ownerUid === "string" ? ownerUid.trim() : "";
  const bid = typeof businessId === "string" ? businessId.trim() : "";
  if (!uid || !bid) return;
  setActiveCategoryId(uid, bid);
  try {
    sessionStorage.setItem(PRIMARY_BUSINESS_SESSION_KEY, JSON.stringify({ uid, businessId: bid }));
  } catch (_) {
    /* ignore */
  }
}

/**
 * Lista todos los negocios del dueño (para selector rápido multi-negocio).
 * @param {*} db
 * @param {string} ownerUid
 * @returns {Promise<Array<{ id: string, data: Record<string, unknown> }>>}
 */
export async function fetchBusinessesForOwnerList(db, ownerUid) {
  if (!ownerUid || typeof ownerUid !== "string") return [];
  const categoryRows = await listUserCategories(db, ownerUid).catch(() => []);
  if (categoryRows.length) {
    return categoryRows.map((r) => ({
      id: r.id,
      data: normalizeBusinessDocument({
        ...r.data,
        businessCategory: r.id,
        category: r.id,
        ownerUid,
        businessName: r.data?.businessName || r.data?.displayName || r.id,
      }),
    }));
  }
  const q = query(collection(db, "businesses"), where("ownerUid", "==", ownerUid));
  let snap;
  try {
    snap = await getDocsFromServer(q);
  } catch {
    snap = await getDocs(q);
  }
  const rows = snap.docs.map((d) => ({ id: d.id, data: normalizeBusinessDocument(d.data() || {}) }));
  rows.sort((a, b) => {
    const ta = toDate(a.data?.createdAt)?.getTime() ?? 0;
    const tb = toDate(b.data?.createdAt)?.getTime() ?? 0;
    if (tb !== ta) return tb - ta;
    return String(a.data?.businessName || "").localeCompare(String(b.data?.businessName || ""), "es");
  });
  return rows;
}

function readSessionPrimaryBusinessId(ownerUid) {
  const uid = typeof ownerUid === "string" ? ownerUid.trim() : "";
  if (!uid) return null;
  try {
    const raw = sessionStorage.getItem(PRIMARY_BUSINESS_SESSION_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || o.uid !== uid || typeof o.businessId !== "string") return null;
    return o.businessId.trim();
  } catch (_) {
    return null;
  }
}

/** Explicit primary in Firestore (any one wins; if several, newest by createdAt + id). */
function rawIsMarkedPrimaryBusiness(raw) {
  if (!raw || typeof raw !== "object") return false;
  if (raw.isPrimary === true) return true;
  if (raw.primary === true) return true;
  if (raw.primaryBusiness === true) return true;
  return false;
}

function compareBusinessCandidates(a, b) {
  const ta = toDate(a.raw.createdAt)?.getTime() ?? 0;
  const tb = toDate(b.raw.createdAt)?.getTime() ?? 0;
  if (tb !== ta) return tb - ta;
  return String(b.id).localeCompare(String(a.id));
}

/**
 * One canonical row: prefer docs marked primary; else newest by createdAt; stable tie-break on id.
 *
 * @param {{ id: string, raw: Record<string, unknown> }[]} rows
 */
function pickPrimaryBusinessRow(rows) {
  if (!rows.length) return null;
  const marked = rows.filter((r) => rawIsMarkedPrimaryBusiness(r.raw));
  const pool = marked.length ? marked : rows;
  return [...pool].sort(compareBusinessCandidates)[0];
}

/**
 * Owner may have more than one `businesses` doc (e.g. repeated onboarding). `limit(1)` was
 * non-deterministic — Dashboard/Solicitudes could read a different doc than the one used in
 * `solicitar.html?businessId=…`, so leads looked “missing”.
 *
 * Selection: explicit `isPrimary` / `primary` / `primaryBusiness` if present; else newest `createdAt`;
 * ties broken by document id (lexicographic) so the choice is stable across modules and reloads.
 * The chosen id is stored in `sessionStorage` for the browser tab session (keyed by uid).
 */
async function fetchBusinessForOwnerImpl(db, ownerUid) {
  const q = query(collection(db, "businesses"), where("ownerUid", "==", ownerUid));
  /** Prefer servidor para ver documentos recién creados (evita caché local vacía tras onboarding). */
  let snap;
  try {
    snap = await getDocsFromServer(q);
  } catch (e) {
    console.warn(
      "[ClientFlow] fetchBusinessForOwner: getDocsFromServer falló; se usa lectura con caché.",
      e,
    );
    snap = await getDocs(q);
  }
  if (snap.empty) return null;
  const rows = snap.docs.map((d) => ({ id: d.id, raw: d.data() }));
  const best = pickPrimaryBusinessRow(rows);
  if (!best) return null;

  const sessionHint = readSessionPrimaryBusinessId(ownerUid);
  const ids = new Set(rows.map((r) => r.id));
  const chosen =
    sessionHint && ids.has(sessionHint)
      ? rows.find((r) => r.id === sessionHint) || best
      : best;

  try {
    sessionStorage.setItem(
      PRIMARY_BUSINESS_SESSION_KEY,
      JSON.stringify({ uid: ownerUid, businessId: chosen.id }),
    );
  } catch (_) {
    /* ignore */
  }

  console.log("Selected primary business:", chosen.id);

  if (rows.length > 1) {
    console.warn(
      `[ClientFlow] fetchBusinessForOwner: ${rows.length} business(es) for uid; selected id=${chosen.id}. Public leads link should use solicitar.html?businessId=${chosen.id}.`,
    );
  } else {
    console.log(
      `[ClientFlow] fetchBusinessForOwner: businesses/${chosen.id} (reads leads/clients from this doc id)`,
    );
  }
  return { id: chosen.id, data: normalizeBusinessDocument(chosen.raw) };
}

export async function fetchBusinessForOwner(db, ownerUid) {
  if (!ownerUid || typeof ownerUid !== "string") return null;
  if (inflightFetchByOwner.has(ownerUid)) {
    return inflightFetchByOwner.get(ownerUid);
  }
  const promise = fetchBusinessForOwnerImpl(db, ownerUid).finally(() => {
    inflightFetchByOwner.delete(ownerUid);
  });
  inflightFetchByOwner.set(ownerUid, promise);
  return promise;
}

function rawBusinessUnclaimed(raw) {
  const o = raw && raw.ownerUid;
  return o === undefined || o === null || o === "";
}

/**
 * Busca documentos por email de negocio (variantes de mayúsculas) para reclamación.
 */
async function collectBusinessDocsByBusinessEmail(db, email) {
  const t = typeof email === "string" ? email.trim() : "";
  if (!t) return [];
  const variants = Array.from(new Set([t, t.toLowerCase()]));
  const byId = new Map();
  for (const em of variants) {
    const q = query(collection(db, "businesses"), where("email", "==", em), limit(25));
    let snap;
    try {
      snap = await getDocsFromServer(q);
    } catch (e) {
      console.warn("[ClientFlow] collectBusinessDocsByBusinessEmail: server read failed", e);
      snap = await getDocs(q);
    }
    snap.forEach((d) => byId.set(d.id, { id: d.id, raw: d.data() }));
  }
  return [...byId.values()];
}

/**
 * Si existe un negocio sin ownerUid cuyo email coincide con la cuenta autenticada, asigna ownerUid.
 */
async function tryClaimUnownedBusinessByEmail(db, uid, authEmail) {
  const rows = await collectBusinessDocsByBusinessEmail(db, authEmail);
  const unowned = rows.filter((r) => rawBusinessUnclaimed(r.raw));
  if (!unowned.length) return null;
  unowned.sort((a, b) => {
    const ta = toDate(a.raw.createdAt)?.getTime() ?? 0;
    const tb = toDate(b.raw.createdAt)?.getTime() ?? 0;
    return tb - ta;
  });
  const pick = unowned[0];
  const docEm = typeof pick.raw.email === "string" ? pick.raw.email.trim().toLowerCase() : "";
  const authEm = authEmail.trim().toLowerCase();
  if (!docEm || docEm !== authEm) {
    console.warn("[ClientFlow] Reclamación cancelada: email del documento no coincide con la cuenta.");
    return null;
  }
  const ref = doc(db, "businesses", pick.id);
  await updateDoc(ref, {
    ownerUid: uid,
    email: authEm,
    updatedAt: serverTimestamp(),
  });
  console.log(`[ClientFlow] Negocio ${pick.id} vinculado a ownerUid (reclamación por email).`);
  return fetchBusinessForOwner(db, uid);
}

/**
 * Resuelve el negocio del usuario: por ownerUid, o reclamando uno sin dueño con el mismo email en el documento.
 * Usar en lugar de fetchBusinessForOwner cuando haya objeto `user` (p. ej. auth.currentUser).
 *
 * @param {{ uid: string, email?: string | null }} user Firebase Auth user o equivalente
 */
export async function resolveBusinessForUser(db, user) {
  if (!user || typeof user.uid !== "string") return null;
  const categoryCtx = await resolveCategoryContextForUser(db, user).catch(() => null);
  if (categoryCtx) {
    const profile = await loadCategoryProfile(db, categoryCtx.uid, categoryCtx.categoryId).catch(() => ({}));
    return {
      id: categoryCtx.categoryId,
      data: normalizeBusinessDocument({
        ...categoryCtx.data,
        ...profile,
        ownerUid: categoryCtx.uid,
        businessCategory: categoryCtx.categoryId,
        category: categoryCtx.categoryId,
      }),
      scope: { uid: categoryCtx.uid, categoryId: categoryCtx.categoryId },
    };
  }
  const uid = user.uid;
  if (inflightResolveByUid.has(uid)) return inflightResolveByUid.get(uid);

  const promise = (async () => {
    const primary = await fetchBusinessForOwner(db, uid);
    if (primary) return primary;
    const em = typeof user.email === "string" ? user.email.trim() : "";
    if (!em) return null;
    return tryClaimUnownedBusinessByEmail(db, uid, em);
  })();

  inflightResolveByUid.set(uid, promise);
  promise.finally(() => inflightResolveByUid.delete(uid));
  return promise;
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
export async function fetchLaunchedRecommendationIds(db, businessId, ownerUid = null) {
  const snap = await getDocs(scopedCategoryCollection(db, businessId, ownerUid, "campaigns"));
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
    const reachEstimate =
      Number.isFinite(reachRaw) && reachRaw > 0 ? Math.round(reachRaw) : null;
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
      usesHeuristicReach: false,
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
/**
 * Jobs / órdenes en `businesses/{businessId}/jobs`, más recientes primero.
 */
export async function fetchJobsForBusiness(db, businessId) {
  const snap = await getDocs(collection(db, "businesses", businessId, "jobs"));
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

export async function fetchClientsForBusiness(db, businessId, ownerUid = null) {
  const path = ownerUid
    ? collection(db, "users", ownerUid, "categories", businessId, "clients")
    : collection(db, "businesses", businessId, "clients");
  const snap = await getDocs(path);
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

/** Pedidos/órdenes ya cerrados (entregados o cancelados). */
const CHAT_INACTIVE_ORDER_STATUSES = new Set([
  "entregado",
  "cancelado",
  "cancelada",
  "cancelled",
  "completed",
  "done",
]);

/** Entregas completadas (últimas N para contexto). */
const CHAT_DELIVERED_STATUSES = new Set(["entregado", "completed", "done"]);

/**
 * @param {Record<string, unknown>} row
 * @returns {boolean}
 */
export function isChatActiveOrderOrJob(row) {
  const s = String(row?.status ?? "")
    .trim()
    .toLowerCase();
  if (!s) return true;
  return !CHAT_INACTIVE_ORDER_STATUSES.has(s);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {boolean}
 */
export function isChatDeliveredOrderOrJob(row) {
  const s = String(row?.status ?? "")
    .trim()
    .toLowerCase();
  return CHAT_DELIVERED_STATUSES.has(s);
}

function orderRowSortTime(row) {
  const u = toDate(row.updatedAt);
  const c = toDate(row.createdAt);
  const tu = u && !Number.isNaN(u.getTime()) ? u.getTime() : 0;
  const tc = c && !Number.isNaN(c.getTime()) ? c.getTime() : 0;
  return Math.max(tu, tc);
}

/**
 * Trabajos (`jobs`): activos + últimas entregas (para memoria operativa sin cargar todo el histórico).
 * @returns {{ active: Record<string, unknown>[], recentDelivered: Record<string, unknown>[] }}
 */
export async function fetchJobsSplitForChat(
  db,
  businessId,
  maxFetch = 150,
  maxActive = 50,
  maxDelivered = 10,
  ownerUid = null,
) {
  const qy = query(
    scopedCategoryCollection(db, businessId, ownerUid, "jobs"),
    orderBy("createdAt", "desc"),
    limit(maxFetch),
  );
  const snap = await getDocs(qy);
  const rows = [];
  snap.forEach((docSnap) => {
    rows.push({ id: docSnap.id, ...docSnap.data(), _cfCollection: "jobs" });
  });
  const active = rows.filter(isChatActiveOrderOrJob).slice(0, maxActive);
  const delivered = rows
    .filter(isChatDeliveredOrderOrJob)
    .sort((a, b) => orderRowSortTime(b) - orderRowSortTime(a))
    .slice(0, maxDelivered);
  return { active, recentDelivered: delivered };
}

/**
 * Pedidos (`orders`): activos + últimas entregas.
 * @returns {{ active: Record<string, unknown>[], recentDelivered: Record<string, unknown>[] }}
 */
export async function fetchOrdersSplitForChat(
  db,
  businessId,
  maxFetch = 150,
  maxActive = 50,
  maxDelivered = 10,
  ownerUid = null,
) {
  const qy = query(
    scopedCategoryCollection(db, businessId, ownerUid, "orders"),
    orderBy("createdAt", "desc"),
    limit(maxFetch),
  );
  const snap = await getDocs(qy);
  const rows = [];
  snap.forEach((docSnap) => {
    rows.push({ id: docSnap.id, ...docSnap.data(), _cfCollection: "orders" });
  });
  const active = rows.filter(isChatActiveOrderOrJob).slice(0, maxActive);
  const delivered = rows
    .filter(isChatDeliveredOrderOrJob)
    .sort((a, b) => orderRowSortTime(b) - orderRowSortTime(a))
    .slice(0, maxDelivered);
  return { active, recentDelivered: delivered };
}

/**
 * Últimos N clientes (más recientes primero) para contexto Chat Maya.
 */
export async function fetchClientsForChatContext(db, businessId, limitN = 30, ownerUid = null) {
  const qy = query(
    scopedCategoryCollection(db, businessId, ownerUid, "clients"),
    orderBy("createdAt", "desc"),
    limit(limitN),
  );
  const snap = await getDocs(qy);
  const rows = [];
  snap.forEach((docSnap) => {
    rows.push({ id: docSnap.id, ...docSnap.data() });
  });
  return rows;
}

/**
 * Movimientos de finanzas del mes calendario actual (lee hasta `maxRead` docs recientes y filtra).
 */
export async function fetchFinanceTransactionsCurrentMonth(db, businessId, maxRead = 250, ownerUid = null) {
  const rows = await fetchFinanceTransactionsForBusiness(db, businessId, maxRead, ownerUid);
  const now = new Date();
  const startM = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const endM = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const out = [];
  for (const row of rows) {
    const raw = row.date ?? row.createdAt;
    const d = toDate(raw);
    if (!d || Number.isNaN(d.getTime())) continue;
    const t = d.getTime();
    if (t >= startM.getTime() && t <= endM.getTime()) out.push(row);
  }
  out.sort((a, b) => {
    const ta = toDate(a.date ?? a.createdAt)?.getTime() ?? 0;
    const tb = toDate(b.date ?? b.createdAt)?.getTime() ?? 0;
    return tb - ta;
  });
  return out;
}

function fixedExpStartOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fixedExpEndOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * @param {number} year
 * @param {number} month 0-11
 * @param {number} day
 */
function fixedExpClampDom(year, month, day) {
  const last = new Date(year, month + 1, 0).getDate();
  return Math.min(Math.max(1, Math.floor(day)), last);
}

/**
 * @param {Date} d
 */
function fixedExpAtNoon(d) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  return x;
}

/**
 * @param {unknown} v
 * @returns {Date | null}
 */
export function fixedExpenseParseFechaCobro(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : fixedExpAtNoon(v);
  if (typeof v === "object" && v !== null && typeof /** @type {{ toDate?: () => Date }} */ (v).toDate === "function") {
    try {
      const d = /** @type {{ toDate: () => Date }} */ (v).toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? fixedExpAtNoon(d) : null;
    } catch {
      return null;
    }
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) {
    const d = new Date(`${v.trim().slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : fixedExpAtNoon(d);
  }
  return null;
}

/**
 * @param {Date} anchorNoon
 */
function fixedExpStepMonthly(anchorNoon) {
  const y = anchorNoon.getFullYear();
  const m = anchorNoon.getMonth();
  const day = anchorNoon.getDate();
  const nm = m + 1;
  const ny = nm > 11 ? y + 1 : y;
  const nmo = nm > 11 ? 0 : nm;
  const last = new Date(ny, nmo + 1, 0).getDate();
  const dom = Math.min(day, last);
  return fixedExpAtNoon(new Date(ny, nmo, dom, 12, 0, 0, 0));
}

/**
 * @param {Date} anchorNoon
 */
function fixedExpStepWeekly(anchorNoon) {
  const x = new Date(anchorNoon);
  x.setDate(x.getDate() + 7);
  return fixedExpAtNoon(x);
}

/**
 * @param {Date} anchorNoon
 */
function fixedExpStepAnnual(anchorNoon) {
  const y = anchorNoon.getFullYear() + 1;
  const m = anchorNoon.getMonth();
  const day = anchorNoon.getDate();
  const last = new Date(y, m + 1, 0).getDate();
  return fixedExpAtNoon(new Date(y, m, Math.min(day, last), 12, 0, 0, 0));
}

/**
 * @param {unknown} raw
 * @returns {"monthly" | "weekly" | "annual"}
 */
function fixedExpNormalizeFreq(raw) {
  const f = String(raw || "monthly").toLowerCase();
  if (f === "weekly") return "weekly";
  if (f === "annual" || f === "yearly" || f === "anual") return "annual";
  return "monthly";
}

/**
 * @param {Date} anchorNoon
 * @param {"monthly" | "weekly"} freq
 * @param {Date} rangeStartDay
 */
function fixedExpAdvanceToOnOrAfter(anchorNoon, freq, rangeStartDay) {
  const target = fixedExpStartOfDay(rangeStartDay).getTime();
  let d = fixedExpAtNoon(new Date(anchorNoon));
  let guard = 0;
  while (d.getTime() < target && guard < 480) {
    guard += 1;
    d = freq === "weekly" ? fixedExpStepWeekly(d) : freq === "annual" ? fixedExpStepAnnual(d) : fixedExpStepMonthly(d);
  }
  return d;
}

/**
 * Suma por ancla `fechaCobro` (fecha calendario completa): cuenta cada ocurrencia
 * (mensual = mismo día del mes; semanal = +7 días) que cae en [rangeStart, rangeEnd] y ≤ asOfDate.
 * Compatibilidad: si no hay `fechaCobro`, usa chargeDayOfMonth / chargeWeekday (comportamiento anterior).
 *
 * @param {Array<Record<string, unknown>>} rows
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 * @param {Date} asOfDate
 * @returns {number}
 */
export function sumAccruedFixedExpensesBetween(rows, rangeStart, rangeEnd, asOfDate) {
  const rs = fixedExpStartOfDay(rangeStart);
  const re = fixedExpEndOfDay(rangeEnd);
  const cap = fixedExpEndOfDay(asOfDate);
  const effectiveEnd = new Date(Math.min(re.getTime(), cap.getTime()));
  if (effectiveEnd.getTime() < rs.getTime()) return 0;

  let sum = 0;

  for (const raw of rows) {
    if (raw.active === false) continue;
    const amt = Number(raw.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const freq = fixedExpNormalizeFreq(raw.frequency);
    const anchor = fixedExpenseParseFechaCobro(raw.fechaCobro);

    if (anchor) {
      let d = fixedExpAdvanceToOnOrAfter(anchor, freq, rs);
      let guard = 0;
      while (guard < 200) {
        guard += 1;
        if (d.getTime() > effectiveEnd.getTime()) break;
        if (d.getTime() >= rs.getTime() && d.getTime() <= re.getTime() && d.getTime() <= effectiveEnd.getTime()) {
          sum += amt;
        }
        d = freq === "weekly" ? fixedExpStepWeekly(d) : freq === "annual" ? fixedExpStepAnnual(d) : fixedExpStepMonthly(d);
      }
      continue;
    }

    if (freq === "monthly") {
      const domRaw = raw.chargeDayOfMonth;
      const dClamped = Number.isFinite(Number(domRaw)) ? Math.min(31, Math.max(1, Math.floor(Number(domRaw)))) : 1;
      let y = rs.getFullYear();
      let m = rs.getMonth();
      const endY = effectiveEnd.getFullYear();
      const endM = effectiveEnd.getMonth();
      let guard = 0;
      while ((y < endY || (y === endY && m <= endM)) && guard < 36) {
        guard += 1;
        const dayUse = fixedExpClampDom(y, m, dClamped);
        const due = new Date(y, m, dayUse, 12, 0, 0, 0);
        if (due.getTime() >= rs.getTime() && due.getTime() <= effectiveEnd.getTime()) {
          sum += amt;
        }
        m += 1;
        if (m > 11) {
          m = 0;
          y += 1;
        }
      }
    } else if (freq === "weekly") {
      const wdRaw = raw.chargeWeekday;
      const wd = Number.isFinite(Number(wdRaw)) ? Math.min(6, Math.max(0, Math.floor(Number(wdRaw)))) : 1;
      const d0 = fixedExpStartOfDay(new Date(rs));
      let d = new Date(d0);
      while (d.getTime() <= effectiveEnd.getTime()) {
        if (d.getTime() <= re.getTime() && d.getDay() === wd) {
          sum += amt;
        }
        d.setDate(d.getDate() + 1);
      }
    } else if (freq === "annual") {
      const anchorAnnual = fixedExpenseParseFechaCobro(raw.fechaCobro);
      if (anchorAnnual) {
        let y = rs.getFullYear();
        const endY = effectiveEnd.getFullYear();
        let guard = 0;
        while (y <= endY && guard < 12) {
          guard += 1;
          const m = anchorAnnual.getMonth();
          const day = anchorAnnual.getDate();
          const last = new Date(y, m + 1, 0).getDate();
          const due = new Date(y, m, Math.min(day, last), 12, 0, 0, 0);
          if (due.getTime() >= rs.getTime() && due.getTime() <= effectiveEnd.getTime()) sum += amt;
          y += 1;
        }
      }
    }
  }
  return sum;
}

/**
 * Primera fecha de cobro (ancla o legado) ≥ inicio del día `fromDate`.
 * @param {Record<string, unknown>} row
 * @param {Date} [fromDate]
 * @returns {Date | null}
 */
export function fixedExpenseNextDueOnOrAfter(row, fromDate = new Date()) {
  const freq = fixedExpNormalizeFreq(row.frequency);
  const anchor = fixedExpenseParseFechaCobro(row.fechaCobro);
  if (anchor) {
    return fixedExpAdvanceToOnOrAfter(anchor, freq, fromDate);
  }
  const start = fixedExpStartOfDay(fromDate);
  if (freq === "weekly") {
    const wdRaw = row.chargeWeekday;
    const wd = Number.isFinite(Number(wdRaw)) ? Math.min(6, Math.max(0, Math.floor(Number(wdRaw)))) : 1;
    for (let i = 0; i < 370; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      if (d.getDay() === wd) return fixedExpAtNoon(d);
    }
    return null;
  }
  if (freq === "annual") {
    const anchor = fixedExpenseParseFechaCobro(row.fechaCobro);
    if (anchor) {
      let y = start.getFullYear();
      for (let guard = 0; guard < 8; guard++) {
        const m = anchor.getMonth();
        const day = anchor.getDate();
        const last = new Date(y, m + 1, 0).getDate();
        const due = new Date(y, m, Math.min(day, last), 12, 0, 0, 0);
        if (due.getTime() >= start.getTime()) return due;
        y += 1;
      }
      return null;
    }
  }
  const domRaw = row.chargeDayOfMonth;
  const dClamped = Number.isFinite(Number(domRaw)) ? Math.min(31, Math.max(1, Math.floor(Number(domRaw)))) : 1;
  let y = start.getFullYear();
  let m = start.getMonth();
  for (let guard = 0; guard < 24; guard++) {
    const dayUse = fixedExpClampDom(y, m, dClamped);
    const due = new Date(y, m, dayUse, 12, 0, 0, 0);
    if (due.getTime() >= start.getTime()) return due;
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return null;
}

/**
 * Primera fecha de cobro **estrictamente después** del fin del día `asOf` (para “Próximo cobro” en UI).
 * @param {Record<string, unknown>} row
 * @param {Date} [asOf]
 * @returns {Date | null}
 */
export function fixedExpenseNextChargeStrictlyAfter(row, asOf = new Date()) {
  const first = fixedExpenseNextDueOnOrAfter(row, fixedExpStartOfDay(asOf));
  if (!first) return null;
  const eo = fixedExpEndOfDay(asOf);
  const freq = fixedExpNormalizeFreq(row.frequency);
  if (first.getTime() <= eo.getTime()) {
    return freq === "weekly" ? fixedExpStepWeekly(first) : freq === "annual" ? fixedExpStepAnnual(first) : fixedExpStepMonthly(first);
  }
  return first;
}

/**
 * @param {Record<string, unknown>} row
 * @param {Date} [asOf]
 * @returns {{ nextCobro: Date | null, status: "pendiente" | "listo", usesCalendar: boolean }}
 */
export function fixedExpenseScheduleUi(row, asOf = new Date()) {
  const usesCalendar = Boolean(fixedExpenseParseFechaCobro(row.fechaCobro));
  const ds = fixedExpStartOfDay(asOf);
  const de = fixedExpEndOfDay(asOf);
  const countsToday = sumAccruedFixedExpensesBetween([row], ds, de, asOf) > 0;
  const nextCobro = fixedExpenseNextChargeStrictlyAfter(row, asOf);
  return {
    nextCobro,
    status: countsToday ? "listo" : "pendiente",
    usesCalendar,
  };
}

/**
 * Gastos fijos ya devengados en el mes calendario actual (para contexto Maya / resúmenes).
 * @param {*} db
 * @param {string} businessId
 * @returns {Promise<number>}
 */
export async function fetchAccruedFixedExpenseTotalForCurrentMonth(db, businessId) {
  const snap = await getDocs(collection(db, "businesses", businessId, "fixedExpenses"));
  const rows = snap.docs.map((d) => d.data());
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return sumAccruedFixedExpensesBetween(rows, start, end, now);
}

/**
 * Eventos de calendario desde hoy hasta `daysAhead` días (p. ej. 28 = 4 semanas).
 */
export async function fetchCalendarEventsForChat(
  db,
  businessId,
  daysAhead = 28,
  maxResults = 120,
  ownerUid = null,
) {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const limitEnd = new Date(dayStart);
  limitEnd.setDate(limitEnd.getDate() + daysAhead);
  limitEnd.setHours(23, 59, 59, 999);

  let snap;
  try {
    const qy = query(
      scopedCategoryCollection(db, businessId, ownerUid, "calendar"),
      where("date", ">=", Timestamp.fromDate(dayStart)),
      orderBy("date", "asc"),
      limit(maxResults),
    );
    snap = await getDocs(qy);
  } catch (e) {
    console.warn("[ClientFlow] fetchCalendarEventsForChat: query ascendente falló, usando escaneo acotado", e);
    const qy = query(
      scopedCategoryCollection(db, businessId, ownerUid, "calendar"),
      orderBy("date", "desc"),
      limit(150),
    );
    snap = await getDocs(qy);
  }

  const rows = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const d = toDate(data.date);
    if (!d || Number.isNaN(d.getTime())) return;
    if (d.getTime() < dayStart.getTime() || d.getTime() > limitEnd.getTime()) return;
    rows.push({ id: docSnap.id, ...data });
  });
  rows.sort((a, b) => {
    const ta = toDate(a.date)?.getTime() ?? 0;
    const tb = toDate(b.date)?.getTime() ?? 0;
    return ta - tb;
  });
  return rows;
}

/**
 * Movimientos en `businesses/{businessId}/finance`, más recientes por `date` primero.
 */
export async function fetchFinanceTransactionsForBusiness(db, businessId, maxDocs = 200, ownerUid = null) {
  const qy = query(
    scopedCategoryCollection(db, businessId, ownerUid, "finance"),
    orderBy("date", "desc"),
    limit(maxDocs),
  );
  const snap = await getDocs(qy);
  const rows = [];
  snap.forEach((docSnap) => {
    rows.push({ id: docSnap.id, ...docSnap.data() });
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
export async function fetchCampaignsListAndStats(db, businessId, ownerUid = null) {
  const snap = await getDocs(scopedCategoryCollection(db, businessId, ownerUid, "campaigns"));
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

    const conv = Number(row.conversions);
    const clk = Number(row.clicks);
    if (Number.isFinite(conv) && conv >= 0) totalConv += Math.round(conv);
    else if (Number.isFinite(clk) && clk >= 0) totalConv += Math.round(clk);
  }

  if (totalConv === 0 && totalLeads > 0) {
    totalConv = 0;
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

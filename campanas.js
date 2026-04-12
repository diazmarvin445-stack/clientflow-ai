import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  addDoc,
  collection,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  campaignPlatformDisplayName,
  fetchBusinessForOwner,
  fetchCampaignsListAndStats,
  fetchLaunchedRecommendationIds,
  formatBusinessMeta,
  formatShortDate,
  initialsFromName,
} from "./dashboard-data.js";
import { generateCampaignRecommendations, formatUsd } from "./campanas-campaign-sim.js";
import { initDashShell, openComingSoon } from "./dash-shell.js";

const LOG_PREFIX = "[ClientFlow Campañas]";

function logProfileDebug(business) {
  if (!business?.data) {
    console.log(LOG_PREFIX, "No business document (null).");
    return;
  }
  const { id, data } = business;
  console.log(LOG_PREFIX, "Business doc id:", id);
  console.log(LOG_PREFIX, "Raw field keys:", Object.keys(data));
  try {
    const safe = JSON.parse(
      JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
    console.log(LOG_PREFIX, "Normalized profile (JSON-safe):", safe);
  } catch (e) {
    console.log(LOG_PREFIX, "Profile snapshot (object):", data);
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * @param {{ id: string, data: Record<string, unknown> } | null} business
 * @param {{ loading?: boolean }} [opts]
 */
function renderHeader(business, opts = {}) {
  const nameEl = document.getElementById("dash-business-name");
  const metaEl = document.getElementById("dash-business-meta");
  const av = document.getElementById("dash-avatar-initials");

  if (!business) {
    if (nameEl) nameEl.textContent = "Campañas IA";
    if (metaEl) {
      metaEl.textContent = opts.loading ? "Cargando perfil…" : "Sin negocio vinculado aún";
    }
    if (av) av.textContent = opts.loading ? "…" : "?";
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

function platformClass(platform) {
  if (platform === "instagram") return "camp-ai-platform camp-ai-platform--instagram";
  if (platform === "google") return "camp-ai-platform camp-ai-platform--google";
  return "camp-ai-platform camp-ai-platform--facebook";
}

function showCampLaunchSuccessToast() {
  const el = document.getElementById("camp-launch-toast");
  if (!el) return;
  el.textContent = "Campaña lanzada correctamente";
  el.hidden = false;
  const prev = showCampLaunchSuccessToast._timer;
  if (prev) clearTimeout(prev);
  showCampLaunchSuccessToast._timer = setTimeout(() => {
    el.hidden = true;
  }, 4500);
}

function markLaunchButtonLaunched(btn) {
  btn.removeAttribute("aria-busy");
  btn.removeAttribute("data-saving");
  btn.disabled = true;
  btn.textContent = "Campaña activa";
  btn.classList.remove("dash-quick-btn--primary");
  btn.classList.add("is-launched");
  btn.setAttribute("aria-label", "Campaña activa");
}

function showCampaignSaveError(message) {
  const box = document.getElementById("camp-campaign-save-error");
  const text = document.getElementById("camp-campaign-save-error-text");
  if (text) text.textContent = message;
  if (box) box.hidden = false;
}

function hideCampaignSaveError() {
  const box = document.getElementById("camp-campaign-save-error");
  if (box) box.hidden = true;
}

function liveCampaignStatusPresentation(status) {
  const s = String(status || "").toLowerCase();
  if (s === "paused") return { label: "Pausada", mod: "paused" };
  if (s === "completed" || s === "ended" || s === "finalizada" || s === "finished") {
    return { label: "Finalizada", mod: "ended" };
  }
  return { label: "Activa", mod: "active" };
}

function reachForCampaignRow(row) {
  const el = Number(row.estimatedLeads);
  const leadsPart = Number.isFinite(el) && el >= 0 ? Math.round(el) : 0;
  const er = Number(row.estimatedReach);
  if (Number.isFinite(er) && er > 0) return Math.round(er);
  return Math.max(160, Math.round(leadsPart * 36));
}

function renderHubStats(agg) {
  setText("camp-hub-active", String(agg.activeCount));
  setText("camp-hub-leads", agg.totalLeads.toLocaleString("es"));
  setText("camp-hub-reach", agg.totalReach.toLocaleString("es"));
  setText("camp-hub-conv", agg.totalConversions.toLocaleString("es"));
}

function renderLiveCampaignCard(row) {
  const title =
    (typeof row.title === "string" && row.title.trim()) || "Campaña sin título";
  const plat = campaignPlatformDisplayName(row.platform);
  const status = liveCampaignStatusPresentation(row.status);
  const budget = Number(row.recommendedBudget);
  const budgetStr = Number.isFinite(budget) && budget >= 0 ? `${formatUsd(budget)} / sem` : "—";
  const reachN = reachForCampaignRow(row);
  const leadsN = Number(row.estimatedLeads);
  const leadsStr = Number.isFinite(leadsN) && leadsN >= 0 ? String(Math.round(leadsN)) : "—";
  const startStr = formatShortDate(row.createdAt);

  const article = document.createElement("article");
  article.className = "camp-live-card";
  article.setAttribute("data-campaign-doc-id", row.id);

  const top = document.createElement("div");
  top.className = "camp-live-card-top";

  const titles = document.createElement("div");
  titles.className = "camp-live-card-titles";

  const h3 = document.createElement("h3");
  h3.className = "camp-live-card-title";
  h3.textContent = title;

  const platEl = document.createElement("span");
  platEl.className = `camp-live-platform ${platformClass(row.platform)}`;
  platEl.textContent = plat;

  titles.append(h3, platEl);

  const badge = document.createElement("span");
  badge.className = `camp-live-badge camp-live-badge--${status.mod}`;
  badge.textContent = status.label;

  top.append(titles, badge);

  const grid = document.createElement("dl");
  grid.className = "camp-live-meta";

  const addRow = (dtText, ddText) => {
    const wrap = document.createElement("div");
    wrap.className = "camp-live-meta-row";
    const dt = document.createElement("dt");
    dt.textContent = dtText;
    const dd = document.createElement("dd");
    dd.textContent = ddText;
    wrap.append(dt, dd);
    grid.appendChild(wrap);
  };

  addRow("Presupuesto", budgetStr);
  addRow("Alcance estimado", reachN.toLocaleString("es"));
  addRow("Leads generados (est.)", leadsStr);
  addRow("Inicio", startStr);

  article.append(top, grid);
  return article;
}

function renderLiveCampaigns(campaigns) {
  const listEl = document.getElementById("camp-live-list");
  const emptyEl = document.getElementById("camp-live-empty");
  if (!listEl || !emptyEl) return;

  listEl.replaceChildren();

  if (!campaigns.length) {
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;
  campaigns.forEach((row) => {
    listEl.appendChild(renderLiveCampaignCard(row));
  });
}

async function refreshCampaignsHub(businessId) {
  const agg = await fetchCampaignsListAndStats(db, businessId);
  renderHubStats(agg);
  renderLiveCampaigns(agg.campaigns);
  return agg;
}

async function saveCampaignFromRecommendation(businessId, c, btn) {
  if (btn.disabled || btn.dataset.saving === "1") return;

  hideCampaignSaveError();
  btn.dataset.saving = "1";
  btn.setAttribute("aria-busy", "true");

  const campaignsCol = collection(db, "businesses", businessId, "campaigns");
  const payload = {
    title: c.name,
    platform: c.platform,
    recommendedBudget: c.budgetWeekly,
    estimatedLeads: c.estimatedLeadsWeekly,
    audience: c.audience,
    adDescription: c.adDescription,
    status: "active",
    createdAt: serverTimestamp(),
    recommendationId: c.id,
  };

  console.log("Launching campaign...", { businessId, path: `businesses/${businessId}/campaigns`, payload });

  try {
    await addDoc(campaignsCol, payload);
    markLaunchButtonLaunched(btn);
    showCampLaunchSuccessToast();
    await refreshCampaignsHub(businessId);
  } catch (err) {
    console.error("Campaign save failed", err);
    btn.removeAttribute("aria-busy");
    delete btn.dataset.saving;
    const msg =
      err && typeof err.message === "string"
        ? err.message
        : "Error desconocido al guardar en Firestore.";
    showCampaignSaveError(
      `No se pudo guardar la campaña: ${msg}. Revisa reglas de seguridad (escritura en businesses/{id}/campaigns) y la consola.`,
    );
  }
}

function renderCampaignCard(c, businessId, launchedIds) {
  const article = document.createElement("article");
  article.className = "camp-ai-card";
  article.setAttribute("data-campaign-id", c.id);
  article.setAttribute("data-recommended-budget-weekly", String(c.budgetWeekly));
  article.setAttribute("data-estimated-leads-weekly", String(c.estimatedLeadsWeekly));
  article.setAttribute("data-platform", c.platform);

  const top = document.createElement("div");
  top.className = "camp-ai-card-top";

  const h3 = document.createElement("h3");
  h3.className = "camp-ai-card-title";
  h3.textContent = c.name;

  const plat = document.createElement("span");
  plat.className = platformClass(c.platform);
  plat.setAttribute("data-platform-label", "");
  plat.textContent = c.platformLabel;

  top.append(h3, plat);

  const dl = document.createElement("dl");
  dl.className = "camp-ai-meta";

  const row = (dtText, ddNode) => {
    const wrap = document.createElement("div");
    wrap.className = "camp-ai-meta-row";
    const dt = document.createElement("dt");
    dt.textContent = dtText;
    const dd = document.createElement("dd");
    if (typeof ddNode === "string") dd.textContent = ddNode;
    else dd.appendChild(ddNode);
    wrap.append(dt, dd);
    return wrap;
  };

  const budgetDd = document.createElement("dd");
  const strongB = document.createElement("strong");
  strongB.textContent = formatUsd(c.budgetWeekly);
  budgetDd.append(strongB, " / semana");

  const leadsDd = document.createElement("dd");
  const strongL = document.createElement("strong");
  strongL.textContent = String(c.estimatedLeadsWeekly);
  leadsDd.append(strongL, " / semana");

  dl.append(
    row("Presupuesto recomendado", budgetDd),
    row("Leads estimados", leadsDd),
    row("Audiencia sugerida", c.audience),
  );

  const full = document.createElement("div");
  full.className = "camp-ai-meta-row camp-ai-meta-row--full";
  const dtDesc = document.createElement("dt");
  dtDesc.textContent = "Descripción del anuncio";
  const ddDesc = document.createElement("dd");
  ddDesc.textContent = c.adDescription;
  full.append(dtDesc, ddDesc);
  dl.appendChild(full);

  const actions = document.createElement("div");
  actions.className = "camp-ai-actions";

  const btnLaunch = document.createElement("button");
  btnLaunch.type = "button";
  btnLaunch.className = "dash-quick-btn dash-quick-btn--primary camp-ai-btn-launch";
  btnLaunch.textContent = "Lanzar Campaña";

  const already = launchedIds.has(c.id);
  if (already) {
    markLaunchButtonLaunched(btnLaunch);
  } else {
    btnLaunch.addEventListener("click", () => saveCampaignFromRecommendation(businessId, c, btnLaunch));
  }

  const btnEdit = document.createElement("button");
  btnEdit.type = "button";
  btnEdit.className = "dash-quick-btn camp-ai-btn-edit";
  btnEdit.textContent = "Editar";
  btnEdit.addEventListener("click", () => {
    openComingSoon(
      "Editor de campaña",
      "Aquí podrás ajustar creatividades, segmentación y presupuesto antes de publicar. Lo activaremos en la siguiente iteración.",
    );
  });

  actions.append(btnLaunch, btnEdit);
  article.append(top, dl, actions);

  return article;
}

function renderRecommendationSummary(summary) {
  if (!summary) return;
  setText(
    "camp-reco-summary-line",
    `${summary.campaignsSuggested} propuestas · ${formatUsd(summary.totalBudgetWeekly)}/sem combinado · ~${summary.estimatedLeadsWeekly} leads/semana estimados · foco ${summary.bestPlatformLabel}`,
  );
}

function setLoadingVisible(show) {
  const loading = document.getElementById("camp-loading");
  if (loading) loading.hidden = !show;
}

function setHubLoading(isLoading) {
  const stats = document.getElementById("camp-hub-stats");
  if (stats) stats.setAttribute("aria-busy", isLoading ? "true" : "false");
}

function showFirestoreError(message) {
  const box = document.getElementById("camp-firestore-error");
  const text = document.getElementById("camp-firestore-error-text");
  if (text) text.textContent = message;
  if (box) box.hidden = false;
}

function hideFirestoreError() {
  const box = document.getElementById("camp-firestore-error");
  if (box) box.hidden = true;
}

function setHubVisible(show) {
  const root = document.getElementById("camp-hub-root");
  if (root) root.hidden = !show;
}

async function renderCampaignsPage(business) {
  const listEl = document.getElementById("ai-campaign-recommendations");
  const emptyEl = document.getElementById("camp-empty-state");
  const noteEl = document.querySelector(".camp-demo-note");

  if (!listEl) return;

  if (!business) {
    listEl.hidden = true;
    listEl.innerHTML = "";
    listEl.setAttribute("data-campaign-source", "none");
    if (emptyEl) emptyEl.hidden = false;
    setHubVisible(false);
    setText("camp-reco-summary-line", "");
    if (noteEl) {
      noteEl.textContent =
        "Completa el onboarding para guardar tu negocio en Firestore y generar campañas aquí.";
    }
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  setHubVisible(true);

  try {
    setHubLoading(true);
    await refreshCampaignsHub(business.id);
  } catch (e) {
    console.warn(LOG_PREFIX, "Could not load campaign hub stats:", e);
    renderHubStats({
      activeCount: 0,
      totalLeads: 0,
      totalReach: 0,
      totalConversions: 0,
      campaigns: [],
    });
    renderLiveCampaigns([]);
    const liveEmpty = document.getElementById("camp-live-empty");
    if (liveEmpty) liveEmpty.hidden = false;
  } finally {
    setHubLoading(false);
  }

  const { data } = business;
  let result;
  try {
    result = generateCampaignRecommendations(data);
  } catch (e) {
    console.error(LOG_PREFIX, "generateCampaignRecommendations failed:", e);
    showFirestoreError(
      "No se pudieron calcular las campañas a partir del perfil. Revisa la consola o vuelve a guardar el onboarding.",
    );
    listEl.hidden = true;
    listEl.innerHTML = "";
    setText("camp-reco-summary-line", "");
    return;
  }

  listEl.hidden = false;
  listEl.setAttribute("data-campaign-source", "firebase-profile");
  listEl.setAttribute("data-vertical", result.vertical);
  listEl.innerHTML = "";

  let launchedIds = new Set();
  try {
    launchedIds = await fetchLaunchedRecommendationIds(db, business.id);
  } catch (e) {
    console.warn(LOG_PREFIX, "Could not read existing campaigns:", e);
  }

  result.campaigns.forEach((c) => {
    listEl.appendChild(renderCampaignCard(c, business.id, launchedIds));
  });

  renderRecommendationSummary(result.summary);

  if (noteEl) {
    noteEl.textContent =
      "Las tarjetas superiores usan tus campañas guardadas. Las recomendaciones inferiores se calculan desde tu perfil (simulación orientativa).";
  }
}

function wireNewCampaignCta() {
  const btn = document.getElementById("camp-new-campaign-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const target = document.getElementById("ai-campaign-recommendations");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.add("camp-reco-highlight");
      window.setTimeout(() => target.classList.remove("camp-reco-highlight"), 1600);
    }
  });
}

async function loadCampanasForUser(user) {
  console.log(LOG_PREFIX, "Loading for uid:", user.uid);

  setLoadingVisible(true);
  renderHeader(null, { loading: true });

  try {
    if (typeof auth.authStateReady === "function") {
      await auth.authStateReady();
    }

    const business = await fetchBusinessForOwner(db, user.uid);
    logProfileDebug(business);

    hideFirestoreError();
    hideCampaignSaveError();
    renderHeader(business, {});
    await renderCampaignsPage(business);
  } catch (err) {
    console.error(LOG_PREFIX, "Firestore / render error:", err);
    renderHeader(null, { loading: false });
    showFirestoreError(
      err && err.message
        ? `Error al leer tu negocio: ${err.message}. Comprueba reglas de Firestore y la consola.`
        : "Error al leer tu negocio en Firestore. Comprueba reglas, red y la consola.",
    );
    await renderCampaignsPage(null);
  } finally {
    setLoadingVisible(false);
    console.log(LOG_PREFIX, "Load finished (loading UI cleared).");
  }
}

function boot() {
  initDashShell({ auth });
  wireNewCampaignCta();

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      console.log(LOG_PREFIX, "No user — redirect to login.");
      window.location.replace("login.html");
      return;
    }

    loadCampanasForUser(user).catch((err) => {
      console.error(LOG_PREFIX, "Unhandled loadCampanasForUser:", err);
      setLoadingVisible(false);
      showFirestoreError("Error inesperado al cargar la página. Recarga e inténtalo de nuevo.");
      renderCampaignsPage(null);
    });
  });
}

boot();

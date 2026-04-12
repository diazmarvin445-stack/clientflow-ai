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
  getCampaignGeneratorProfileDefaults,
  initialsFromName,
} from "./dashboard-data.js";
import { generateCampaignRecommendations, formatUsd } from "./campanas-campaign-sim.js";
import { mockGenerateCampaignFromInputs } from "./campanas-ai-generator.js";
import { initDashShell, openComingSoon } from "./dash-shell.js";

const LOG_PREFIX = "[ClientFlow Campañas]";
/** Set false to silence temporary generator wiring logs. */
const DEBUG_CAMPAIGN_GENERATOR = true;

/** @type {{ business: { id: string, data: Record<string, unknown> } | null, last: { inputs: Record<string, string>, output: Record<string, unknown> } | null, genVariation: number, prefillBusinessId: string | null }} */
const genState = {
  business: null,
  last: null,
  genVariation: 0,
  prefillBusinessId: null,
};

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

function showCampLaunchSuccessToast(message) {
  const el = document.getElementById("camp-launch-toast");
  if (!el) return;
  el.textContent = message || "Campaña guardada";
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

function excerptText(s, maxLen) {
  const t = typeof s === "string" ? s.trim() : "";
  if (!t) return "";
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(0, maxLen - 1)).trim()}…`;
}

function renderLiveCampaignCard(row) {
  const title =
    (typeof row.title === "string" && row.title.trim()) || "Campaña sin título";
  const isGenerator = row.sourceType === "ai-generator";
  const plat = campaignPlatformDisplayName(row.platform);
  const status = liveCampaignStatusPresentation(row.status);
  const budget = Number(row.recommendedBudget);
  const budgetStr = Number.isFinite(budget) && budget >= 0 ? `${formatUsd(budget)} / sem` : "—";
  const reachN = reachForCampaignRow(row);
  const leadsN = Number(row.estimatedLeads);
  const leadsStr = Number.isFinite(leadsN) && leadsN >= 0 ? String(Math.round(leadsN)) : "—";
  const startStr = formatShortDate(row.createdAt);
  const hookLine = typeof row.hook === "string" ? row.hook.trim() : "";
  const ctaLine = typeof row.cta === "string" ? row.cta.trim() : "";
  const bodyPreview = excerptText(
    typeof row.adDescription === "string" ? row.adDescription : "",
    155,
  );

  const article = document.createElement("article");
  article.className = isGenerator ? "camp-live-card camp-live-card--from-ia" : "camp-live-card";
  article.setAttribute("data-campaign-doc-id", row.id);

  const top = document.createElement("div");
  top.className = "camp-live-card-top";

  const titles = document.createElement("div");
  titles.className = "camp-live-card-titles";

  if (isGenerator) {
    const kicker = document.createElement("p");
    kicker.className = "camp-live-card-kicker";
    kicker.textContent = "Desde el generador";
    titles.appendChild(kicker);
  }

  const h3 = document.createElement("h3");
  h3.className = "camp-live-card-title";
  h3.textContent = title;

  const platEl = document.createElement("span");
  platEl.className = `camp-live-platform ${platformClass(row.platform)}`;
  platEl.textContent = plat;

  titles.append(h3);

  if (isGenerator && hookLine) {
    const hookEl = document.createElement("p");
    hookEl.className = "camp-live-card-hook";
    hookEl.textContent = hookLine;
    titles.appendChild(hookEl);
  }

  if (isGenerator && bodyPreview) {
    const prev = document.createElement("p");
    prev.className = "camp-live-card-preview";
    prev.textContent = bodyPreview;
    titles.appendChild(prev);
  }

  titles.appendChild(platEl);

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
  if (isGenerator && ctaLine) {
    addRow("CTA sugerido", ctaLine);
  }
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
    showCampLaunchSuccessToast("Campaña guardada");
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
  btnLaunch.textContent = "Guardar campaña";

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
    `Vista previa orientativa · ${formatUsd(summary.totalBudgetWeekly)}/sem · ~${summary.estimatedLeadsWeekly} leads/semana estimados · plataforma ${summary.bestPlatformLabel}`,
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
    genState.business = null;
    genState.prefillBusinessId = null;
    clearGeneratorFormFields();
    resetGeneratorUI();
    listEl.hidden = true;
    listEl.innerHTML = "";
    listEl.setAttribute("data-campaign-source", "none");
    if (emptyEl) emptyEl.hidden = false;
    setHubVisible(false);
    setText("camp-reco-summary-line", "");
    if (noteEl) {
      noteEl.textContent =
        "Completa el onboarding para guardar tu negocio en Firestore y usar el generador aquí.";
    }
    return;
  }

  genState.business = business;

  if (genState.prefillBusinessId !== business.id) {
    applyGeneratorPrefillFromBusiness(data);
    genState.prefillBusinessId = business.id;
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
      "No se pudo calcular la sugerencia a partir del perfil. Revisa la consola o vuelve a guardar el onboarding.",
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
      "El generador usa tus campos; la sugerencia inferior resume tu perfil guardado. Ambas son orientativas (demostración).";
  }
}

function genFormVal(id) {
  const el = document.getElementById(id);
  return el && "value" in el ? String(el.value).trim() : "";
}

/**
 * Lee el formulario del generador en el DOM (única fuente de verdad al generar).
 * @returns {{ goal: string, offer: string, location: string, budget: string, audience: string, platformPref: string }}
 */
function readGeneratorInputsFromDom() {
  return {
    goal: genFormVal("camp-gen-goal"),
    offer: genFormVal("camp-gen-offer"),
    location: genFormVal("camp-gen-location"),
    budget: genFormVal("camp-gen-budget"),
    audience: genFormVal("camp-gen-audience"),
    platformPref: (() => {
      const el = document.getElementById("camp-gen-platform");
      return el && "value" in el ? String(el.value) : "auto";
    })(),
  };
}

function setGeneratorFormField(id, value) {
  const el = document.getElementById(id);
  if (el && "value" in el) el.value = value ?? "";
}

/** Vacía el generador si no hay negocio vinculado. */
function clearGeneratorFormFields() {
  setGeneratorFormField("camp-gen-goal", "");
  setGeneratorFormField("camp-gen-offer", "");
  setGeneratorFormField("camp-gen-location", "");
  setGeneratorFormField("camp-gen-budget", "");
  setGeneratorFormField("camp-gen-audience", "");
  setGeneratorFormField("camp-gen-platform", "auto");
}

/**
 * Rellena el formulario con datos del perfil (una vez por negocio al cargar).
 * @param {Record<string, unknown>} data
 */
function applyGeneratorPrefillFromBusiness(data) {
  const d = getCampaignGeneratorProfileDefaults(data);
  setGeneratorFormField("camp-gen-goal", d.goal);
  setGeneratorFormField("camp-gen-offer", d.offer);
  setGeneratorFormField("camp-gen-location", d.location);
  setGeneratorFormField("camp-gen-budget", d.budget);
  setGeneratorFormField("camp-gen-audience", d.audience);
  setGeneratorFormField("camp-gen-platform", d.platformPref || "auto");
}

/**
 * Valores efectivos para el mock: campo del formulario si el usuario escribió algo; si no, perfil.
 * @param {ReturnType<typeof readGeneratorInputsFromDom>} fromDom
 * @param {ReturnType<typeof getCampaignGeneratorProfileDefaults>} profile
 */
function mergeCampaignGeneratorInputs(fromDom, profile) {
  const nz = (s) => (typeof s === "string" && s.trim() ? s.trim() : "");
  return {
    goal: nz(fromDom.goal) || nz(profile.goal) || "",
    offer: nz(fromDom.offer) || nz(profile.offer) || "",
    location: nz(fromDom.location) || nz(profile.location) || "",
    budget: nz(fromDom.budget) || nz(profile.budget) || "",
    audience: nz(fromDom.audience) || nz(profile.audience) || "",
    platformPref: nz(fromDom.platformPref) || nz(profile.platformPref) || "auto",
  };
}

function hashStringForDebug(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return String(Math.abs(h));
}

function resetGeneratorUI() {
  genState.last = null;
  genState.genVariation = 0;
  const out = document.getElementById("camp-gen-output");
  const saveBtn = document.getElementById("camp-gen-save-btn");
  const hint = document.getElementById("camp-gen-save-hint");
  const note = document.getElementById("camp-gen-output-note");
  if (out) out.hidden = true;
  if (saveBtn) saveBtn.disabled = true;
  if (hint) hint.textContent = "";
  if (note) note.textContent = "";
}

function fillGeneratorOutput(data) {
  setText("camp-gen-out-headline", data.headline);
  setText("camp-gen-out-hook", data.hook);
  setText("camp-gen-out-body", data.bodyText);
  setText("camp-gen-out-cta", data.cta);
  setText(
    "camp-gen-out-platform",
    typeof data.platformDisplayLabel === "string" && data.platformDisplayLabel.trim()
      ? data.platformDisplayLabel
      : campaignPlatformDisplayName(data.platform),
  );
  setText("camp-gen-out-budget", `${formatUsd(data.suggestedBudgetWeekly)} / semana`);
  setText("camp-gen-out-leads", String(data.estimatedLeadsWeekly));
  setText("camp-gen-out-creative", data.creativeIdea);
}

async function saveGeneratedCampaign(businessId, pack) {
  const { output: data, inputs } = pack;
  const campaignsCol = collection(db, "businesses", businessId, "campaigns");
  const audienceLine = [inputs.goal, inputs.audience, inputs.location].filter(Boolean).join(" · ") || "—";
  await addDoc(campaignsCol, {
    title: data.headline.slice(0, 120),
    platform: data.platform,
    recommendedBudget: data.suggestedBudgetWeekly,
    estimatedLeads: data.estimatedLeadsWeekly,
    audience: audienceLine,
    adDescription: data.bodyText,
    headline: data.headline,
    hook: data.hook,
    cta: data.cta,
    creativeIdea: data.creativeIdea,
    status: "active",
    sourceType: "ai-generator",
    generatorInputs: inputs,
    createdAt: serverTimestamp(),
  });
}

function runCampaignGenerator() {
  const b = genState.business;
  if (!b) return;
  const genBtn = document.getElementById("camp-gen-generate-btn");
  const regenBtn = document.getElementById("camp-gen-regenerate-btn");
  const saveBtn = document.getElementById("camp-gen-save-btn");
  hideCampaignSaveError();
  const hint = document.getElementById("camp-gen-save-hint");
  const note = document.getElementById("camp-gen-output-note");
  const outWrap = document.getElementById("camp-gen-output");
  const inputsAtEvent = readGeneratorInputsFromDom();
  const profileDefaults = getCampaignGeneratorProfileDefaults(b.data);
  if (DEBUG_CAMPAIGN_GENERATOR) {
    console.log(`${LOG_PREFIX} [gen] DOM inputs at click`, {
      goal: inputsAtEvent.goal,
      offer: inputsAtEvent.offer,
      location: inputsAtEvent.location,
      budget: inputsAtEvent.budget,
      audience: inputsAtEvent.audience,
      platformPref: inputsAtEvent.platformPref,
      profileDefaults,
    });
  }

  const displayName =
    (typeof b.data.businessName === "string" && b.data.businessName.trim()) || "Tu negocio";
  if (genBtn) {
    genBtn.disabled = true;
    genBtn.setAttribute("aria-busy", "true");
  }
  if (regenBtn) {
    regenBtn.disabled = true;
    regenBtn.setAttribute("aria-busy", "true");
  }
  if (note) note.textContent = "Generando borrador…";
  if (outWrap) outWrap.hidden = false;
  if (hint) hint.textContent = "";

  window.setTimeout(() => {
    try {
      const fromDom = readGeneratorInputsFromDom();
      const diverged = JSON.stringify(fromDom) !== JSON.stringify(inputsAtEvent);
      const inputs = mergeCampaignGeneratorInputs(fromDom, profileDefaults);
      if (DEBUG_CAMPAIGN_GENERATOR) {
        console.log(`${LOG_PREFIX} [gen] merged inputs → mockGenerateCampaignFromInputs`, {
          fromDom,
          merged: inputs,
          reReadMatchesClick: !diverged,
        });
        if (diverged) {
          console.warn(`${LOG_PREFIX} [gen] DOM at click vs pre-mock differ (IME/autofill?)`, {
            atClick: inputsAtEvent,
            preMock: fromDom,
          });
        }
      }
      genState.genVariation += 1;
      const output = mockGenerateCampaignFromInputs(inputs, displayName, genState.genVariation);
      genState.last = { inputs, output };
      if (DEBUG_CAMPAIGN_GENERATOR) {
        console.log(`${LOG_PREFIX} [gen] mock result digest`, {
          headline: output.headline,
          hookPreview: output.hook.slice(0, 120),
          cta: output.cta,
          platform: output.platform,
          platformDisplayLabel: output.platformDisplayLabel,
          suggestedBudgetWeekly: output.suggestedBudgetWeekly,
          estimatedLeadsWeekly: output.estimatedLeadsWeekly,
          inputFingerprint: hashStringForDebug(JSON.stringify(inputs)),
        });
      }
      fillGeneratorOutput(output);
      if (note) {
        note.textContent =
          "Borrador de demostración a partir de tus datos. Los números son estimaciones orientativas.";
      }
      if (saveBtn) saveBtn.disabled = false;
      const resultCard = document.getElementById("camp-gen-result-card");
      if (resultCard) {
        window.requestAnimationFrame(() => {
          resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      }
    } catch (e) {
      console.error(LOG_PREFIX, "Generator mock failed:", e);
      if (note) note.textContent = "No se pudo generar. Inténtalo de nuevo.";
      if (outWrap) outWrap.hidden = true;
    } finally {
      if (genBtn) {
        genBtn.disabled = false;
        genBtn.removeAttribute("aria-busy");
      }
      if (regenBtn) {
        regenBtn.disabled = false;
        regenBtn.removeAttribute("aria-busy");
      }
    }
  }, 420);
}

function wireCampaignGenerator() {
  const genBtn = document.getElementById("camp-gen-generate-btn");
  const regenBtn = document.getElementById("camp-gen-regenerate-btn");
  const saveBtn = document.getElementById("camp-gen-save-btn");
  if (!genBtn || !saveBtn || genBtn.dataset.wired === "1") return;
  genBtn.dataset.wired = "1";

  genBtn.addEventListener("click", () => runCampaignGenerator());
  if (regenBtn) regenBtn.addEventListener("click", () => runCampaignGenerator());

  saveBtn.addEventListener("click", async () => {
    const b = genState.business;
    const pack = genState.last;
    if (!b || !pack) return;
    const hint = document.getElementById("camp-gen-save-hint");
    saveBtn.disabled = true;
    saveBtn.setAttribute("aria-busy", "true");
    hideCampaignSaveError();
    if (hint) hint.textContent = "";
    try {
      await saveGeneratedCampaign(b.id, pack);
      showCampLaunchSuccessToast("Campaña guardada");
      if (hint) hint.textContent = "Listo — aparece en «Campañas guardadas».";
      await refreshCampaignsHub(b.id);
      window.setTimeout(() => {
        if (hint) hint.textContent = "";
      }, 4000);
    } catch (err) {
      console.error(LOG_PREFIX, "Save generated campaign failed:", err);
      showCampaignSaveError(
        err && err.message
          ? `No se pudo guardar: ${err.message}`
          : "No se pudo guardar la campaña. Revisa Firestore y la consola.",
      );
    } finally {
      saveBtn.disabled = false;
      saveBtn.removeAttribute("aria-busy");
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
  wireCampaignGenerator();

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

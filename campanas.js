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
import { mockGenerateCampaignFromInputs } from "./campanas-ai-generator.js";
import { initDashShell, openComingSoon } from "./dash-shell.js";

const LOG_PREFIX = "[ClientFlow Campañas]";

/** @type {{ business: { id: string, data: Record<string, unknown> } | null, last: { inputs: Record<string, string>, output: Record<string, unknown> } | null }} */
const genState = {
  business: null,
  last: null,
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
  el.textContent = message || "Campaña lanzada correctamente";
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
  const isGenerator = row.sourceType === "ai-generator";
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

  if (isGenerator) {
    const kicker = document.createElement("p");
    kicker.className = "camp-live-card-kicker";
    kicker.textContent = "Generada con IA";
    titles.appendChild(kicker);
  }

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
    genState.business = null;
    resetGeneratorUI();
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

  genState.business = business;

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
      "El generador superior crea borradores desde tus campos (simulación hasta conectar OpenAI). Las recomendaciones inferiores se calculan desde tu perfil guardado.";
  }
}

function genFormVal(id) {
  const el = document.getElementById(id);
  return el && "value" in el ? String(el.value).trim() : "";
}

function resetGeneratorUI() {
  genState.last = null;
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
  setText("camp-gen-out-platform", campaignPlatformDisplayName(data.platform));
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

function wireCampaignGenerator() {
  const genBtn = document.getElementById("camp-gen-generate-btn");
  const saveBtn = document.getElementById("camp-gen-save-btn");
  if (!genBtn || !saveBtn || genBtn.dataset.wired === "1") return;
  genBtn.dataset.wired = "1";

  genBtn.addEventListener("click", () => {
    const b = genState.business;
    if (!b) return;
    hideCampaignSaveError();
    const hint = document.getElementById("camp-gen-save-hint");
    const note = document.getElementById("camp-gen-output-note");
    const outWrap = document.getElementById("camp-gen-output");
    const inputs = {
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

    const displayName =
      (typeof b.data.businessName === "string" && b.data.businessName.trim()) || "Tu negocio";
    genBtn.disabled = true;
    genBtn.setAttribute("aria-busy", "true");
    if (note) note.textContent = "Generando borrador…";
    if (outWrap) outWrap.hidden = false;
    if (hint) hint.textContent = "";

    window.setTimeout(() => {
      try {
        const output = mockGenerateCampaignFromInputs(inputs, displayName);
        genState.last = { inputs, output };
        fillGeneratorOutput(output);
        if (note) {
          note.textContent =
            "Borrador generado (simulación). Conecta OpenAI más adelante para textos a medida.";
        }
        if (saveBtn) saveBtn.disabled = false;
      } catch (e) {
        console.error(LOG_PREFIX, "Generator mock failed:", e);
        if (note) note.textContent = "No se pudo generar. Inténtalo de nuevo.";
        if (outWrap) outWrap.hidden = true;
      } finally {
        genBtn.disabled = false;
        genBtn.removeAttribute("aria-busy");
      }
    }, 420);
  });

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
      if (hint) hint.textContent = "Listo — aparece en «Tus campañas».";
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

function wireNewCampaignCta() {
  const btn = document.getElementById("camp-new-campaign-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const target = document.getElementById("camp-gen-section") || document.getElementById("ai-campaign-recommendations");
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

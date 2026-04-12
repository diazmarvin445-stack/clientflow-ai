import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  doc,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  fetchBusinessForOwner,
  formatBusinessMeta,
  initialsFromName,
  SERVICE_LABELS,
} from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";

/** @type {string | null} */
let businessId = null;
/** @type {Record<string, unknown> | null} */
let businessData = null;
/** @type {string | null} */
let pendingLogoDataUrl = null;

function renderHeader(business) {
  const nameEl = document.getElementById("dash-business-name");
  const metaEl = document.getElementById("dash-business-meta");
  const av = document.getElementById("dash-avatar-initials");

  if (!business) {
    if (nameEl) nameEl.textContent = "Configuración";
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

function val(id) {
  const el = document.getElementById(id);
  return el && "value" in el ? String(el.value) : "";
}

function setVal(id, text) {
  const el = document.getElementById(id);
  if (el && "value" in el) el.value = text ?? "";
}

function showError(msg) {
  const el = document.getElementById("cfg-load-error");
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

function feedback(id, msg, ok = true) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("cfg-save-feedback--ok", ok && !!msg);
  el.classList.toggle("cfg-save-feedback--bad", !ok && !!msg);
  if (msg) {
    window.setTimeout(() => {
      el.textContent = "";
      el.classList.remove("cfg-save-feedback--ok", "cfg-save-feedback--bad");
    }, 3500);
  }
}

function integrationConnected(data, key) {
  const int = data && data.integrations;
  if (!int || typeof int !== "object") return false;
  const node = int[key];
  return !!(node && typeof node === "object" && node.connected === true);
}

function renderIntegrationCards() {
  if (!businessData) return;
  document.querySelectorAll(".cfg-int-card").forEach((card) => {
    const key = card.getAttribute("data-int-key");
    if (!key) return;
    const on = integrationConnected(businessData, key);
    const badge = card.querySelector("[data-int-badge]");
    const btn = card.querySelector(".cfg-int-toggle");
    if (badge) {
      badge.textContent = on ? "Conectado" : "No conectado";
      badge.classList.toggle("cfg-int-badge--on", on);
      badge.classList.toggle("cfg-int-badge--off", !on);
    }
    if (btn) btn.textContent = on ? "Desconectar" : "Conectar";
  });
}

function servicesToTextarea(services) {
  if (!Array.isArray(services) || !services.length) return "";
  return services.map((s) => SERVICE_LABELS[s] || s).join(", ");
}

function applyFormFromBusiness(data) {
  businessData = data;
  pendingLogoDataUrl = null;

  setVal("cfg-business-name", data.businessName || "");
  setVal("cfg-industry", typeof data.industry === "string" ? data.industry : "");
  setVal("cfg-phone", data.phone || "");
  setVal("cfg-email", data.email || "");
  setVal("cfg-address", data.commercialAddress || "");
  setVal("cfg-service-area", data.serviceArea || "");

  setVal("cfg-logo-url", data.brandLogoUrl || "");
  setVal("cfg-tagline", data.tagline || "");
  setVal("cfg-color-primary", data.brandPrimaryColor || "#2563eb");
  setVal("cfg-color-secondary", data.brandSecondaryColor || "#10b981");

  const preview = document.getElementById("cfg-logo-preview");
  if (preview) {
    preview.innerHTML = "";
    const src = pendingLogoDataUrl || data.brandLogoDataUrl || data.brandLogoUrl;
    if (typeof src === "string" && src.trim()) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "Logo";
      img.className = "cfg-logo-preview-img";
      preview.appendChild(img);
    }
  }

  setVal("cfg-mkt-budget", data.marketingMonthlyBudget != null ? String(data.marketingMonthlyBudget) : "");
  setVal("cfg-mkt-goal", data.marketingGoal || "leads");
  setVal("cfg-ideal-audience", data.marketingIdealAudience || "");
  setVal("cfg-main-services", data.marketingMainServicesText || servicesToTextarea(data.services));

  setVal("cfg-hours-from", data.hoursFrom || "");
  setVal("cfg-hours-to", data.hoursTo || "");
  setVal("cfg-timezone", data.timezone || "America/Mexico_City");
  {
    let np = typeof data.notificationPreference === "string" ? data.notificationPreference : "both";
    if (np === "email") np = "both";
    const allowed = ["both", "in_app", "minimal"];
    if (!allowed.includes(np)) np = "both";
    setVal("cfg-notify", np);
  }

  const days = Array.isArray(data.days) ? data.days : [];
  document.querySelectorAll('input[name="cfg-day"]').forEach((cb) => {
    if (cb instanceof HTMLInputElement) {
      cb.checked = days.includes(cb.value);
    }
  });

  renderIntegrationCards();
}

async function saveSection(section) {
  if (!businessId || !businessData) return;

  const ref = doc(db, "businesses", businessId);
  const base = { updatedAt: serverTimestamp() };

  try {
    if (section === "business") {
      await updateDoc(ref, {
        ...base,
        businessName: val("cfg-business-name").trim(),
        industry: val("cfg-industry").trim(),
        phone: val("cfg-phone").trim(),
        email: val("cfg-email").trim(),
        commercialAddress: val("cfg-address").trim(),
        serviceArea: val("cfg-service-area").trim(),
      });
      feedback("cfg-feedback-business", "Cambios guardados", true);
    } else if (section === "brand") {
      const payload = {
        ...base,
        brandLogoUrl: val("cfg-logo-url").trim(),
        tagline: val("cfg-tagline").trim(),
        brandPrimaryColor: val("cfg-color-primary").trim(),
        brandSecondaryColor: val("cfg-color-secondary").trim(),
      };
      if (pendingLogoDataUrl) {
        payload.brandLogoDataUrl = pendingLogoDataUrl;
      }
      await updateDoc(ref, payload);
      feedback("cfg-feedback-brand", "Cambios guardados", true);
    } else if (section === "marketing") {
      const rawB = val("cfg-mkt-budget").trim();
      const budget = rawB === "" ? null : Number(rawB);
      await updateDoc(ref, {
        ...base,
        marketingMonthlyBudget: Number.isFinite(budget) ? budget : null,
        marketingGoal: val("cfg-mkt-goal").trim() || "leads",
        marketingIdealAudience: val("cfg-ideal-audience").trim(),
        marketingMainServicesText: val("cfg-main-services").trim(),
      });
      feedback("cfg-feedback-marketing", "Cambios guardados", true);
    } else if (section === "platform") {
      const days = Array.from(document.querySelectorAll('input[name="cfg-day"]:checked')).map(
        (el) => el.value,
      );
      await updateDoc(ref, {
        ...base,
        hoursFrom: val("cfg-hours-from").trim(),
        hoursTo: val("cfg-hours-to").trim(),
        days,
        timezone: val("cfg-timezone").trim(),
        notificationPreference: val("cfg-notify").trim() || "both",
      });
      feedback("cfg-feedback-platform", "Cambios guardados", true);
    }

    const business = await fetchBusinessForOwner(db, auth.currentUser.uid);
    if (business) {
      businessId = business.id;
      businessData = business.data;
      applyFormFromBusiness(business.data);
    }
  } catch (err) {
    console.error(err);
    const fb =
      section === "business"
        ? "cfg-feedback-business"
        : section === "brand"
          ? "cfg-feedback-brand"
          : section === "marketing"
            ? "cfg-feedback-marketing"
            : "cfg-feedback-platform";
    feedback(fb, "No se pudo guardar. Revisa tu conexión e inténtalo otra vez.", false);
  }
}

async function toggleIntegration(key) {
  if (!businessId || !businessData) return;
  const next = !integrationConnected(businessData, key);
  const ref = doc(db, "businesses", businessId);
  const foot = document.getElementById("cfg-feedback-integrations");
  try {
    await updateDoc(ref, {
      [`integrations.${key}`]: { connected: next },
      updatedAt: serverTimestamp(),
    });
    if (!businessData.integrations) businessData.integrations = {};
    businessData.integrations[key] = { connected: next };
    renderIntegrationCards();
    if (foot) {
      foot.textContent = next
        ? "Listo. Cuando activemos la conexión real, te avisamos aquí."
        : "Quedó desconectado.";
      window.setTimeout(() => {
        if (foot) foot.textContent = "";
      }, 4000);
    }
  } catch (err) {
    console.error(err);
    if (foot) foot.textContent = "No se pudo guardar el cambio. Inténtalo otra vez.";
  }
}

function wireLogoFile() {
  const input = document.getElementById("cfg-logo-file");
  const preview = document.getElementById("cfg-logo-preview");
  if (!input || !preview) return;
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 400 * 1024) {
      alert("La imagen pesa más de 400 KB. Prueba con un archivo más liviano.");
      input.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      pendingLogoDataUrl = result;
      preview.innerHTML = "";
      const img = document.createElement("img");
      img.src = result;
      img.alt = "Vista previa del logo";
      img.className = "cfg-logo-preview-img";
      preview.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

function wireSaveButtons() {
  document.querySelectorAll(".cfg-save").forEach((btn) => {
    btn.addEventListener("click", () => {
      const section = btn.getAttribute("data-cfg");
      if (section) saveSection(section);
    });
  });
}

function wireIntegrations() {
  document.querySelectorAll(".cfg-int-card").forEach((card) => {
    const key = card.getAttribute("data-int-key");
    const toggle = card.querySelector(".cfg-int-toggle");
    if (!key || !toggle) return;
    toggle.addEventListener("click", () => toggleIntegration(key));
  });
}

async function loadPage(user) {
  showError("");
  businessId = null;
  businessData = null;

  const noBiz = document.getElementById("cfg-no-business");
  const main = document.getElementById("cfg-main");

  try {
    const business = await fetchBusinessForOwner(db, user.uid);
    renderHeader(business);

    if (!business) {
      if (noBiz) noBiz.hidden = false;
      if (main) main.hidden = true;
      return;
    }

    businessId = business.id;
    applyFormFromBusiness(business.data);

    if (noBiz) noBiz.hidden = true;
    if (main) main.hidden = false;
  } catch (err) {
    console.error(err);
    showError("No se pudo cargar la configuración. Inténtalo de nuevo.");
    if (noBiz) noBiz.hidden = true;
    if (main) main.hidden = true;
  }
}

function boot() {
  initDashShell({ auth });
  wireLogoFile();
  wireSaveButtons();
  wireIntegrations();

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    loadPage(user).catch((err) => {
      console.error(err);
      showError("Error al cargar la página.");
    });
  });
}

boot();

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  receiptSettingsDocRef,
  RECEIPT_SETTINGS_DEFAULTS,
  loadReceiptSettingsForForm,
} from "./receipt-settings.js";
import {
  initialsFromName,
  SERVICE_LABELS,
} from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";
import { logPlatformIssue, setDiagnosticsLoggerContext, wireGlobalDiagnosticsListeners } from "./diagnostics-logger.js";

/** @type {string | null} */
let scopeUid = null;
/** @type {Record<string, unknown> | null} */
let businessData = null;
/** @type {boolean} */
let hasBusinessProfile = false;
/** @type {string | null} */
let pendingLogoDataUrl = null;
/** @type {string | null} */
let pendingReceiptLogoDataUrl = null;
/** @type {string} */
let cachedReceiptLogoUrl = "";
const CUSTOM_APPAREL_VALUE = "custom-apparel";
const YOURCOLOR_DEFAULT_NAME = "YourColor";

async function saveProfilePatch(patch) {
  const ref = businessProfileRef();
  if (!ref) throw new Error("No se pudo resolver la ruta de perfil.");
  await setDoc(
    ref,
    {
      ownerUid: auth.currentUser.uid,
      updatedAt: serverTimestamp(),
      ...patch,
    },
    { merge: true },
  );
}

function businessProfileRef() {
  if (!scopeUid) return null;
  return doc(db, "users", scopeUid, "yourcolor", "profile");
}

function mapCategoryToIndustry(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  return "custom-apparel";
}

function renderHeader(profileData) {
  const nameEl = document.getElementById("dash-business-name");
  const metaEl = document.getElementById("dash-business-meta");
  const av = document.getElementById("dash-avatar-initials");

  const displayName =
    (typeof profileData?.businessName === "string" && profileData.businessName.trim()) ||
    YOURCOLOR_DEFAULT_NAME;

  if (nameEl) nameEl.textContent = displayName;
  if (metaEl) metaEl.textContent = "YourColor CRM";
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

function syncIndustryCustomFields() {
  const industryEl = document.getElementById("cfg-industry");
  const customFields = document.getElementById("cfg-custom-apparel-fields");
  if (!industryEl || !customFields) return;
  const selected = String(industryEl.value || "").trim();
  customFields.hidden = selected !== CUSTOM_APPAREL_VALUE;
}

function servicesToTextarea(services) {
  if (!Array.isArray(services) || !services.length) return "";
  return services.map((s) => SERVICE_LABELS[s] || s).join(", ");
}

function applyFormFromBusiness(data) {
  businessData = data;
  pendingLogoDataUrl = null;

  setVal("cfg-business-name", data.businessName || "");
  const industryValue =
    typeof data.industry === "string" && data.industry.trim()
      ? data.industry.trim()
      : hasBusinessProfile
        ? mapCategoryToIndustry(data.businessCategory || data.category)
        : "";
  setVal("cfg-industry", industryValue);
  setVal("cfg-custom-products", data.customProducts || "");
  setVal(
    "cfg-custom-min-price",
    data.customMinPrice != null && data.customMinPrice !== "" ? String(data.customMinPrice) : "",
  );
  setVal(
    "cfg-custom-min-qty",
    data.customMinQty != null && data.customMinQty !== "" ? String(data.customMinQty) : "",
  );
  setVal("cfg-custom-delivery-time", data.customDeliveryTime || "");
  setVal("cfg-custom-payment-method", data.customPaymentMethod || "");
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
  syncIndustryCustomFields();
}

async function refreshReceiptSettingsForm() {
  if (!scopeUid) return;
  pendingReceiptLogoDataUrl = null;
  const data = await loadReceiptSettingsForForm(db, scopeUid);
  cachedReceiptLogoUrl = data.logoUrl || "";
  setVal("cfg-receipt-business-name", data.businessName);
  setVal("cfg-receipt-logo-url", cachedReceiptLogoUrl.startsWith("data:") ? "" : cachedReceiptLogoUrl);
  setVal("cfg-receipt-phone", data.phone);
  setVal("cfg-receipt-email", data.email);
  setVal("cfg-receipt-address", data.address);
  setVal("cfg-receipt-footer", data.footerMessage);
  setVal("cfg-receipt-primary-color", data.primaryColor);
  setVal("cfg-receipt-notes", data.notesTerms);
  const preview = document.getElementById("cfg-receipt-logo-preview");
  if (preview) {
    preview.innerHTML = "";
    if (cachedReceiptLogoUrl) {
      const img = document.createElement("img");
      img.src = cachedReceiptLogoUrl;
      img.alt = "Logo del recibo";
      img.className = "cfg-logo-preview-img";
      preview.appendChild(img);
    }
  }
  const fileInput = document.getElementById("cfg-receipt-logo-file");
  if (fileInput && "value" in fileInput) fileInput.value = "";
}

async function saveSection(section) {
  if (!scopeUid) return;
  if (!businessData) businessData = {};

  const base = { updatedAt: serverTimestamp(), ownerUid: auth.currentUser.uid };

  try {
    if (section === "business") {
      const profileRef = businessProfileRef();
      if (!profileRef) throw new Error("No se pudo resolver la ruta de perfil para guardar.");
      const rawMinPrice = val("cfg-custom-min-price").trim();
      const rawMinQty = val("cfg-custom-min-qty").trim();
      const minPrice = rawMinPrice === "" ? null : Number(rawMinPrice);
      const minQty = rawMinQty === "" ? null : Number(rawMinQty);
      await setDoc(
        profileRef,
        {
          ...base,
          businessName: val("cfg-business-name").trim(),
          industry: val("cfg-industry").trim(),
          customProducts: val("cfg-custom-products").trim(),
          customMinPrice: Number.isFinite(minPrice) ? minPrice : null,
          customMinQty: Number.isFinite(minQty) ? Math.round(minQty) : null,
          customDeliveryTime: val("cfg-custom-delivery-time").trim(),
          customPaymentMethod: val("cfg-custom-payment-method").trim(),
          phone: val("cfg-phone").trim(),
          email: val("cfg-email").trim().toLowerCase(),
          commercialAddress: val("cfg-address").trim(),
          serviceArea: val("cfg-service-area").trim(),
        },
        { merge: true },
      );
      await saveProfilePatch({
        ...base,
        businessName: val("cfg-business-name").trim(),
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
      await saveProfilePatch(payload);
      feedback("cfg-feedback-brand", "Cambios guardados", true);
    } else if (section === "marketing") {
      const rawB = val("cfg-mkt-budget").trim();
      const budget = rawB === "" ? null : Number(rawB);
      await saveProfilePatch({
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
      await saveProfilePatch({
        ...base,
        hoursFrom: val("cfg-hours-from").trim(),
        hoursTo: val("cfg-hours-to").trim(),
        days,
        timezone: val("cfg-timezone").trim(),
        notificationPreference: val("cfg-notify").trim() || "both",
      });
      feedback("cfg-feedback-platform", "Cambios guardados", true);
    } else if (section === "receipt") {
      const urlTyped = val("cfg-receipt-logo-url").trim();
      const logoUrl = pendingReceiptLogoDataUrl || (urlTyped ? urlTyped : cachedReceiptLogoUrl);
      await setDoc(
        receiptSettingsDocRef(db, scopeUid),
        {
          businessName: val("cfg-receipt-business-name").trim(),
          logoUrl,
          phone: val("cfg-receipt-phone").trim(),
          email: val("cfg-receipt-email").trim().toLowerCase(),
          address: val("cfg-receipt-address").trim(),
          footerMessage: val("cfg-receipt-footer").trim(),
          primaryColor: val("cfg-receipt-primary-color").trim() || RECEIPT_SETTINGS_DEFAULTS.primaryColor,
          notesTerms: val("cfg-receipt-notes").trim(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      await refreshReceiptSettingsForm();
      feedback("cfg-feedback-receipt", "Cambios guardados", true);
    }

    await loadPage(auth.currentUser);
  } catch (err) {
    console.error(err);
    await logPlatformIssue(
      "config_save_failed",
      "configuracion",
      err?.message || String(err),
      "",
      { section },
      "medium",
    );
    const fb =
      section === "business"
        ? "cfg-feedback-business"
        : section === "brand"
          ? "cfg-feedback-brand"
          : section === "marketing"
            ? "cfg-feedback-marketing"
            : section === "receipt"
              ? "cfg-feedback-receipt"
              : "cfg-feedback-platform";
    feedback(fb, "No se pudo guardar. Revisa tu conexión e inténtalo otra vez.", false);
  }
}

async function toggleIntegration(key) {
  if (!scopeUid || !businessData) return;
  const next = !integrationConnected(businessData, key);
  const foot = document.getElementById("cfg-feedback-integrations");
  try {
    await saveProfilePatch({
      [`integrations.${key}`]: { connected: next },
      updatedAt: serverTimestamp(),
      ownerUid: auth.currentUser.uid,
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
    await logPlatformIssue(
      "integration_toggle_failed",
      "configuracion",
      err?.message || String(err),
      "",
      { integrationKey: key },
      "low",
    );
    if (foot) foot.textContent = "No se pudo guardar el cambio. Inténtalo otra vez.";
  }
}

function wireReceiptLogo() {
  const input = document.getElementById("cfg-receipt-logo-file");
  const preview = document.getElementById("cfg-receipt-logo-preview");
  const clearBtn = document.getElementById("cfg-receipt-logo-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      pendingReceiptLogoDataUrl = null;
      cachedReceiptLogoUrl = "";
      if (input && "value" in input) input.value = "";
      setVal("cfg-receipt-logo-url", "");
      if (preview) preview.innerHTML = "";
    });
  }
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
      pendingReceiptLogoDataUrl = result;
      preview.innerHTML = "";
      const img = document.createElement("img");
      img.src = result;
      img.alt = "Vista previa del logo del recibo";
      img.className = "cfg-logo-preview-img";
      preview.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
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

function wireIndustrySelector() {
  const industryEl = document.getElementById("cfg-industry");
  if (!industryEl) return;
  industryEl.addEventListener("change", syncIndustryCustomFields);
  syncIndustryCustomFields();
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
  businessData = null;
  hasBusinessProfile = false;
  scopeUid = String(user?.uid || "").trim();

  const noBiz = document.getElementById("cfg-no-business");
  const main = document.getElementById("cfg-main");

  try {
    if (!scopeUid) {
      showError("No hay sesión activa.");
      return;
    }

    setDiagnosticsLoggerContext({ businessId: "yourcolor", ownerUid: scopeUid });
    const profileRef = businessProfileRef();
    let profileData = {};
    let profileExists = false;
    if (profileRef) {
      const profileSnap = await getDoc(profileRef);
      profileExists = profileSnap.exists();
      profileData = profileExists ? profileSnap.data() || {} : {};
    }
    hasBusinessProfile = profileExists;
    const mergedForForm = { ...profileData };
    if (!profileExists) {
      mergedForForm.businessName = "";
      mergedForForm.industry = "";
      mergedForForm.phone = "";
      mergedForForm.email = "";
      mergedForForm.commercialAddress = "";
      mergedForForm.serviceArea = "";
    }
    applyFormFromBusiness(mergedForForm);
    renderHeader(mergedForForm);
    try {
      await refreshReceiptSettingsForm();
    } catch (error) {
      // Receipt settings are optional for first-time accounts.
      console.warn("[Configuracion] receipt settings load skipped:", error);
    }
    const diagLink = document.getElementById("cfg-diagnostics-link");
    if (diagLink) diagLink.hidden = false;

    if (noBiz) noBiz.hidden = true;
    if (main) main.hidden = false;
  } catch (error) {
    console.error("CONFIG LOAD ERROR:", error);
    await logPlatformIssue(
      "config_load_failed",
      "configuracion",
      error?.message || String(error),
      "",
      { stage: "loadPage" },
      "high",
    );
    showError("No se pudo cargar la configuración. Inténtalo de nuevo.");
    if (noBiz) noBiz.hidden = true;
    if (main) main.hidden = true;
  }
}

function boot() {
  initDashShell({ auth, db });
  wireGlobalDiagnosticsListeners("configuracion");
  wireLogoFile();
  wireReceiptLogo();
  wireSaveButtons();
  wireIntegrations();
  wireIndustrySelector();

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    loadPage(user).catch((err) => {
      console.error("CONFIG LOAD ERROR:", err);
      showError("Error al cargar la página.");
    });
  });
}

boot();

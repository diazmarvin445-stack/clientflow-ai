import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const FORM_ID = "request-form";
const SUCCESS_ID = "success-message";
const ERROR_ID = "solicitar-config-error";
const FILE_NAME_ID = "file-name";

function getBusinessIdFromHash() {
  const h = window.location.hash || "";
  if (!h || h.indexOf("businessId=") === -1) return null;
  const m = h.match(/businessId=([^&]+)/i);
  if (!m || !m[1]) return null;
  try {
    return decodeURIComponent(m[1]).trim();
  } catch (e) {
    return m[1].trim();
  }
}

function preserveBusinessIdInNavLinks(businessId) {
  if (!businessId) return;
  const q = "?businessId=" + encodeURIComponent(businessId);
  document.querySelectorAll('a[href="solicitar.html"]').forEach((a) => {
    a.setAttribute("href", "solicitar.html" + q);
  });
}

function showConfigError() {
  const err = document.getElementById(ERROR_ID);
  if (err) err.hidden = false;
}

function hideConfigError() {
  const err = document.getElementById(ERROR_ID);
  if (err) err.hidden = true;
}

function bindFileNameHint() {
  const form = document.getElementById(FORM_ID);
  const fileNameEl = document.getElementById(FILE_NAME_ID);
  const fileInput = form ? form.querySelector('input[name="photo"]') : null;
  if (fileInput && fileNameEl) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) {
        fileNameEl.textContent = file.name;
        fileNameEl.hidden = false;
      } else {
        fileNameEl.textContent = "";
        fileNameEl.hidden = true;
      }
    });
  }
}

function initFormSubmit(businessId) {
  const form = document.getElementById(FORM_ID);
  const successEl = document.getElementById(SUCCESS_ID);
  const fileNameEl = document.getElementById(FILE_NAME_ID);
  if (!form || !successEl) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!businessId) {
      console.error("[ClientFlow solicitar] Submit blocked: missing businessId");
      return;
    }

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute("aria-busy", "true");
    }

    const fullName = (form.querySelector('[name="fullName"]') || {}).value || "";
    const phone = (form.querySelector('[name="phone"]') || {}).value || "";
    const address = (form.querySelector('[name="address"]') || {}).value || "";
    const serviceSelect = form.querySelector('[name="service"]');
    const serviceValue = serviceSelect ? serviceSelect.value : "";

    const payload = {
      customerName: fullName.trim(),
      phone: phone.trim(),
      address: address.trim(),
      service: serviceValue,
      description: "",
      status: "new",
      estimatedPrice: 0,
      createdAt: serverTimestamp(),
    };

    const leadsPath = `businesses/${businessId}/leads`;

    try {
      const colRef = collection(db, "businesses", businessId, "leads");
      const docRef = await addDoc(colRef, payload);
      console.log("[ClientFlow solicitar] Lead write OK:", leadsPath, "docId:", docRef.id);

      form.classList.add("is-hidden");
      successEl.hidden = false;
      successEl.scrollIntoView({ behavior: "smooth", block: "nearest" });

      form.reset();
      if (fileNameEl) {
        fileNameEl.textContent = "";
        fileNameEl.hidden = true;
      }
    } catch (err) {
      console.error("[ClientFlow solicitar] Lead write failed:", leadsPath, err);
      alert(
        "No se pudo enviar la solicitud. Comprueba tu conexión y que las reglas de Firestore permitan crear solicitudes públicas.",
      );
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.removeAttribute("aria-busy");
      }
    }
  });
}

/**
 * Resolves the tenant id for public lead creation (must match Solicitudes/Dashboard reads).
 * Uses query string, early inline capture, hash, and a full-URL regex fallback (Live Server / encoding edge cases).
 */
function resolveSolicitarBusinessId() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    const fromQuery = params.get("businessId");
    if (fromQuery && String(fromQuery).trim() !== "") {
      return String(fromQuery).trim();
    }
  } catch (e) {
    /* ignore */
  }

  if (typeof window !== "undefined" && window.__CF_SOLICITAR_BUSINESS_ID__) {
    const early = String(window.__CF_SOLICITAR_BUSINESS_ID__).trim();
    if (early) return early;
  }

  const fromHash = getBusinessIdFromHash();
  if (fromHash && String(fromHash).trim() !== "") {
    return String(fromHash).trim();
  }

  const href = typeof window !== "undefined" && window.location.href ? window.location.href : "";
  const fromHref = href.match(/[?&#]businessId=([^&]+)/i);
  if (fromHref && fromHref[1]) {
    try {
      return decodeURIComponent(fromHref[1]).trim();
    } catch (e) {
      return String(fromHref[1]).trim();
    }
  }

  return null;
}

function boot() {
  bindFileNameHint();

  const businessId = resolveSolicitarBusinessId();
  console.log(
    "[ClientFlow solicitar] Resolved businessId:",
    businessId ?? "(missing — enable form only with ?businessId=)",
  );

  if (!businessId) {
    showConfigError();
    const formMissing = document.getElementById(FORM_ID);
    if (formMissing) {
      formMissing.addEventListener("submit", (e) => {
        e.preventDefault();
      });
    }
    return;
  }

  hideConfigError();
  preserveBusinessIdInNavLinks(businessId);
  initFormSubmit(businessId);
}

boot();

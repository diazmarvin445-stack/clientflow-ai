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

/** Temporary MVP fallback when query/hash have no businessId (remove before production). */
const FALLBACK_BUSINESS_ID = "5YF2W5UyZAuOzq8kCISD";

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
  const form = document.getElementById(FORM_ID);
  if (err) err.hidden = false;
  if (form) {
    form.setAttribute("aria-disabled", "true");
    form.querySelectorAll("input, select, textarea, button").forEach((el) => {
      el.disabled = true;
    });
  }
}

function hideConfigError() {
  const err = document.getElementById(ERROR_ID);
  const form = document.getElementById(FORM_ID);
  if (err) err.hidden = true;
  if (form) {
    form.removeAttribute("aria-disabled");
    form.querySelectorAll("input, select, textarea, button").forEach((el) => {
      el.disabled = false;
    });
  }
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

    if (!businessId) return;

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

    try {
      await addDoc(collection(db, "businesses", businessId, "leads"), payload);

      form.classList.add("is-hidden");
      successEl.hidden = false;
      successEl.scrollIntoView({ behavior: "smooth", block: "nearest" });

      form.reset();
      if (fileNameEl) {
        fileNameEl.textContent = "";
        fileNameEl.hidden = true;
      }
    } catch (err) {
      console.error(err);
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

function boot() {
  bindFileNameHint();

  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("businessId");
  const queryTrimmed =
    fromQuery && String(fromQuery).trim() !== "" ? String(fromQuery).trim() : null;

  const fromHash = getBusinessIdFromHash();
  const hashTrimmed =
    fromHash && String(fromHash).trim() !== "" ? String(fromHash).trim() : null;

  let businessId = queryTrimmed || hashTrimmed || FALLBACK_BUSINESS_ID;
  console.log("Using businessId:", businessId);

  hideConfigError();
  preserveBusinessIdInNavLinks(businessId);
  initFormSubmit(businessId);
}

boot();

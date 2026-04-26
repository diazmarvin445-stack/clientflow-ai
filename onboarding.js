import { db, auth } from "./firebase.js";
import { setSessionPrimaryBusinessId } from "./dashboard-data.js";
import {
  collection,
  addDoc,
  doc,
  setDoc,
  getDocs,
  limit,
  query,
  getDocFromServer,
  serverTimestamp,
  where,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const form = document.getElementById("onboarding-form");
const successEl = document.getElementById("onboarding-success");
const saveErrorEl = document.getElementById("onboarding-save-error");
const panelLinkEl = document.getElementById("onboarding-panel-link");
const inlineDashboardLinkEl = document.getElementById("onboarding-inline-dashboard-link");
const existingBusinessGuardEl = document.getElementById("onboarding-existing-business-guard");
const existingBusinessLinkEl = document.getElementById("onboarding-existing-business-link");
const exitBtnEl = document.getElementById("onboarding-exit-btn");
let businessConfigured = false;

function showSaveError(message) {
  if (!saveErrorEl) {
    console.error("[ClientFlow onboarding] save error (no banner):", message);
    return;
  }
  saveErrorEl.textContent = message;
  saveErrorEl.hidden = false;
  saveErrorEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hideSaveError() {
  if (saveErrorEl) {
    saveErrorEl.textContent = "";
    saveErrorEl.hidden = true;
  }
}

function enterDashboard() {
  console.log("[Onboarding] entering dashboard");
  window.location.href = "dashboard.html";
}

function wireNavigationActions() {
  const wiredAttr = "data-onboarding-nav-wired";
  const panelButtons = [panelLinkEl, inlineDashboardLinkEl, existingBusinessLinkEl].filter(Boolean);
  panelButtons.forEach((el) => {
    if (!el || el.getAttribute(wiredAttr) === "1") return;
    el.setAttribute(wiredAttr, "1");
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const user = auth.currentUser;
      if (user && businessConfigured) {
        enterDashboard();
        return;
      }
      enterDashboard();
    });
  });

  if (exitBtnEl && exitBtnEl.getAttribute(wiredAttr) !== "1") {
    exitBtnEl.setAttribute(wiredAttr, "1");
    exitBtnEl.addEventListener("click", async (e) => {
      e.preventDefault();
      console.log("[Onboarding] signing out");
      try {
        await signOut(auth);
      } catch (err) {
        console.error("[Onboarding] sign out failed:", err);
      }
      window.location.href = "login.html";
    });
  }
}

async function checkExistingBusinessConfigured(user) {
  if (!user || user.isAnonymous) return false;
  const q = query(collection(db, "businesses"), where("ownerUid", "==", user.uid), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return false;
  const businessDoc = snap.docs[0];
  const data = businessDoc.data() || {};
  if (typeof data.businessName === "string" && data.businessName.trim()) return true;
  if (typeof data.businessCategory === "string" && data.businessCategory.trim()) return true;
  try {
    const profile = await getDocFromServer(doc(db, "businesses", businessDoc.id, "settings", "businessProfile"));
    return profile.exists();
  } catch (_) {
    return true;
  }
}
const otherCheck = document.getElementById("service-other-check");
const otherField = document.getElementById("service-other-field");
const dropzone = document.getElementById("photo-dropzone");
const fileInput = document.getElementById("brand-photos");
const fileList = document.getElementById("file-list");

function val(name) {
  if (!form) return "";
  const el = form.querySelector(`[name="${name}"]`);
  return el ? el.value : "";
}

function stripUndefined(obj) {
  const out = {};
  Object.keys(obj).forEach((k) => {
    const v = obj[k];
    if (v !== undefined) {
      out[k] = v;
    }
  });
  return out;
}

function normalizeBusinessCategory(raw) {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "construction_roofing") return "roofing_construction";
  if (v === "roofing_construction") return "roofing_construction";
  if (v === "construction") return "construction";
  return "custom_apparel";
}

let fileBuffer = [];

if (otherCheck && otherField) {
  function syncOther() {
    const on = otherCheck.checked;
    otherField.hidden = !on;
    const input = otherField.querySelector("input");
    if (input) {
      input.required = on;
      if (!on) input.value = "";
    }
  }
  otherCheck.addEventListener("change", syncOther);
  syncOther();
}

function renderFileList() {
  if (!fileList) return;
  fileList.innerHTML = "";
  if (fileBuffer.length === 0) {
    fileList.hidden = true;
    return;
  }
  fileList.hidden = false;
  fileBuffer.forEach((file, index) => {
    const li = document.createElement("li");
    li.className = "file-list-item";
    li.innerHTML =
      '<span class="file-list-name">' +
      escapeHtml(file.name) +
      '</span><button type="button" class="file-list-remove" data-index="' +
      index +
      '" aria-label="Quitar archivo">Quitar</button>';
    fileList.appendChild(li);
  });
  fileList.querySelectorAll(".file-list-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.getAttribute("data-index"), 10);
      fileBuffer.splice(i, 1);
      syncInputFiles();
      renderFileList();
    });
  });
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function syncInputFiles() {
  if (!fileInput) return;
  const dt = new DataTransfer();
  fileBuffer.forEach((f) => {
    dt.items.add(f);
  });
  fileInput.files = dt.files;
}

function addFiles(fileListLike) {
  const added = Array.prototype.slice.call(fileListLike || []);
  added.forEach((f) => {
    if (f.type.indexOf("image/") === 0) {
      fileBuffer.push(f);
    }
  });
  syncInputFiles();
  renderFileList();
}

if (dropzone && fileInput) {
  dropzone.addEventListener("click", (e) => {
    if (e.target.closest(".file-list-remove")) return;
    fileInput.click();
  });

  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", () => {
    addFiles(fileInput.files);
  });

  ["dragenter", "dragover"].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add("is-dragover");
    });
  });

  ["dragleave", "drop"].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove("is-dragover");
    });
  });

  dropzone.addEventListener("drop", (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) {
      addFiles(files);
    }
  });
}

const billingSelect = document.getElementById("billing-method");
const pricingDynamic = document.getElementById("pricing-dynamic");

function syncBillingPanels() {
  if (!billingSelect || !pricingDynamic) return;
  const mode = billingSelect.value;
  pricingDynamic.querySelectorAll(".pricing-dynamic-panel").forEach((panel) => {
    const isActive = panel.getAttribute("data-billing") === mode;
    panel.hidden = !isActive;
    panel.querySelectorAll("input, textarea, select").forEach((el) => {
      el.disabled = !isActive;
    });
  });
}

if (billingSelect) {
  billingSelect.addEventListener("change", syncBillingPanels);
  syncBillingPanels();
}

if (form && successEl) {
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const services = form.querySelectorAll('input[name="services"]:checked');
    if (services.length === 0) {
      alert("Selecciona al menos un servicio.");
      const tags = document.getElementById("service-tags");
      if (tags) tags.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (otherCheck && otherCheck.checked) {
      const detail = form.querySelector('[name="serviceOtherDetail"]');
      if (detail && !detail.value.trim()) {
        alert("Indica qué incluye «Other» o desmárcalo.");
        detail.focus();
        return;
      }
    }

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const raw = stripUndefined({
      businessCategory: val("businessCategory"),
      mayaServices: val("mayaServices"),
      mayaEstimateMethod: val("mayaEstimateMethod"),
      mayaDepositPolicy: val("mayaDepositPolicy"),
      mayaSchedulingPolicy: val("mayaSchedulingPolicy"),
      mayaMaterialsPolicy: val("mayaMaterialsPolicy"),
      mayaTone: val("mayaTone"),
      mayaNoPromises: val("mayaNoPromises"),
      businessName: val("businessName"),
      businessDescription: val("businessDescription"),
      phone: val("phone"),
      email: (() => {
        const e = val("email").trim();
        return e ? e.toLowerCase() : "";
      })(),
      services: Array.from(services).map((c) => c.value),
      serviceOtherDetail: val("serviceOtherDetail"),
      serviceArea: val("serviceArea"),
      maxDistance: val("maxDistance"),
      distanceUnit: val("distanceUnit"),
      billingMethod: val("billingMethod"),
      rateFixed: val("rateFixed"),
      rateHourly: val("rateHourly"),
      rateSqft: val("rateSqft"),
      rateLot: val("rateLot"),
      pricingCustomDetail: val("pricingCustomDetail"),
      minJobPrice: val("minJobPrice"),
      extraDistance: val("extraDistance"),
      extraUrgency: val("extraUrgency"),
      extraMaterials: val("extraMaterials"),
      pricingNotes: val("pricingNotes"),
      days: Array.from(form.querySelectorAll('input[name="days"]:checked')).map((c) => c.value),
      hoursFrom: val("hoursFrom"),
      hoursTo: val("hoursTo"),
      photoCount: fileBuffer.length,
      photoFilesMeta: fileBuffer.map((f) => ({
        name: f.name,
        size: f.size,
        type: f.type,
      })),
    });

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute("aria-busy", "true");
    }
    hideSaveError();

    try {
      if (typeof auth.authStateReady === "function") {
        await auth.authStateReady();
      }
      const u = auth.currentUser;
      console.log("[ClientFlow onboarding] auth.currentUser:", u ? { uid: u.uid, isAnonymous: u.isAnonymous } : null);
      if (!u || u.isAnonymous) {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.removeAttribute("aria-busy");
        }
        window.location.href = `login.html?next=${encodeURIComponent("onboarding.html")}`;
        return;
      }
      const uid = u.uid;

      const normalizedCategory = normalizeBusinessCategory(raw.businessCategory);
      const docData = {
        ...raw,
        businessCategory: normalizedCategory,
        category: normalizedCategory,
        ownerUid: uid,
        source: "onboarding",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const payloadForLog = {
        ...raw,
        ownerUid: uid,
        source: "onboarding",
        createdAt: "[serverTimestamp]",
        updatedAt: "[serverTimestamp]",
      };
      console.log("[ClientFlow onboarding] target write: collection=businesses (auto id)");
      console.log("[ClientFlow onboarding] payload (serializable):", payloadForLog);

      const businessRef = await addDoc(collection(db, "businesses"), docData);
      const path = `businesses/${businessRef.id}`;
      console.log("[ClientFlow onboarding] addDoc success:", { path, id: businessRef.id });

      await setDoc(doc(db, "businesses", businessRef.id, "settings", "businessProfile"), {
        category: normalizedCategory,
        businessName: raw.businessName || "",
        services: raw.mayaServices || "",
        pricingModel: raw.mayaEstimateMethod || "",
        depositPolicy: raw.mayaDepositPolicy || "",
        schedulingPolicy: raw.mayaSchedulingPolicy || "",
        materialsPolicy: raw.mayaMaterialsPolicy || "",
        communicationTone: raw.mayaTone || "",
        noPromises: raw.mayaNoPromises || "",
        updatedAt: serverTimestamp(),
      });

      const verifyRef = doc(db, "businesses", businessRef.id);
      const verified = await getDocFromServer(verifyRef);
      if (!verified.exists) {
        const msg = "El documento se creó pero no se pudo leer desde el servidor. Revisa reglas de Firestore y vuelve a intentar.";
        console.error("[ClientFlow onboarding] verify failed: document missing after create", { path });
        showSaveError(msg);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.removeAttribute("aria-busy");
        }
        return;
      }
      const vData = verified.data();
      const ou = vData && vData.ownerUid;
      console.log("[ClientFlow onboarding] verify read success:", { path, ownerUidInDoc: ou, matchesAuth: ou === uid });
      if (ou !== uid) {
        const msg =
          "El perfil no quedó vinculado a tu cuenta correctamente. Cierra sesión, vuelve a entrar e inténtalo de nuevo. Si persiste, revisa la consola (F12).";
        console.error("[ClientFlow onboarding] verify failed: ownerUid mismatch", { expected: uid, got: ou, path });
        showSaveError(msg);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.removeAttribute("aria-busy");
        }
        return;
      }

      console.log("[ClientFlow onboarding] Negocio creado y verificado.", {
        businessId: businessRef.id,
        ownerUid: uid,
        path,
      });
      console.log(
        "[ClientFlow onboarding] Enlace público de solicitudes:",
        `solicitar.html?businessId=${businessRef.id}`,
      );

      setSessionPrimaryBusinessId(uid, businessRef.id);

      try {
        localStorage.setItem("clientflow_onboarding_v1", JSON.stringify(raw));
      } catch (err) {
        /* ignore quota */
      }

      window.location.assign("dashboard.html");
    } catch (err) {
      const code = err && err.code;
      const message = err && err.message;
      console.error("[ClientFlow onboarding] Firestore write/read failed:", {
        code,
        message,
        name: err && err.name,
        stack: err && err.stack,
      });
      const friendly =
        "No se pudo guardar el negocio. Comprueba la conexión y que las reglas de Firestore permitan crear en «businesses» con tu usuario. Detalle en consola (F12).";
      showSaveError(friendly);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.removeAttribute("aria-busy");
      }
    }
  });
}

/** Misma cuenta que el resto del panel: sin sesión de correo no guardamos (evita ownerUid anónimo ≠ usuario tras login). */
(async function requireAccountForOnboarding() {
  wireNavigationActions();
  if (!form) return;
  if (typeof auth.authStateReady === "function") {
    await auth.authStateReady();
  }
  const user = auth.currentUser;
  console.log("[Onboarding] user:", user?.uid);
  if (!user || user.isAnonymous) {
    window.location.replace(`login.html?next=${encodeURIComponent("onboarding.html")}`);
    return;
  }
  try {
    businessConfigured = await checkExistingBusinessConfigured(user);
  } catch (err) {
    businessConfigured = false;
    console.error("[Onboarding] business check failed:", err);
  }
  console.log("[Onboarding] businessConfigured:", businessConfigured);
  if (existingBusinessGuardEl) {
    existingBusinessGuardEl.hidden = !businessConfigured;
  }
})();

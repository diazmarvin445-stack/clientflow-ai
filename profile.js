import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { doc, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  resolveBusinessForUser,
  formatBusinessMeta,
  initialsFromName,
  clearStoredPrimaryBusiness,
} from "./dashboard-data.js";
import { initDashShell, openComingSoon } from "./dash-shell.js";

function renderHeader(business) {
  const nameEl = document.getElementById("dash-business-name");
  const metaEl = document.getElementById("dash-business-meta");
  const av = document.getElementById("dash-avatar-initials");

  if (!business) {
    if (nameEl) nameEl.textContent = "Mi perfil";
    if (metaEl) metaEl.textContent = "Cuenta";
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

function boot() {
  initDashShell({ auth, db });

  const flashEl = document.getElementById("profile-flash");
  const nameEl = /** @type {HTMLInputElement | null} */ (document.getElementById("profile-name"));
  const emailEl = /** @type {HTMLInputElement | null} */ (document.getElementById("profile-email"));
  const uidEl = /** @type {HTMLInputElement | null} */ (document.getElementById("profile-uid"));
  const userForm = document.getElementById("profile-user-form");
  const userSaveBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById("profile-user-save"));
  const resetBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById("profile-reset-password"));
  const businessForm = document.getElementById("profile-business-form");
  const businessSaveBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById("profile-business-save"));
  const businessNameEl = /** @type {HTMLInputElement | null} */ (document.getElementById("business-name"));
  const businessPhoneEl = /** @type {HTMLInputElement | null} */ (document.getElementById("business-phone"));
  const businessPayEl = /** @type {HTMLTextAreaElement | null} */ (document.getElementById("business-payment-methods"));
  const signOutBtn = document.getElementById("profile-signout");
  /** @type {{ id: string, data: Record<string, unknown> } | null} */
  let currentBusiness = null;
  /** @type {import("firebase/auth").User | null} */
  let currentUser = null;

  function showFlash(msg, isError = false) {
    if (!flashEl) return;
    flashEl.hidden = false;
    flashEl.textContent = msg;
    flashEl.classList.toggle("is-error", isError);
    flashEl.classList.toggle("is-ok", !isError);
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    currentUser = user;

    if (nameEl) nameEl.value = user.displayName || "";
    if (emailEl) emailEl.value = user.email || "";
    if (uidEl) uidEl.value = user.uid;

    try {
      const business = await resolveBusinessForUser(db, user);
      currentBusiness = business;
      renderHeader(business);
      if (businessNameEl) businessNameEl.value = String(business?.data?.businessName || "");
      if (businessPhoneEl) businessPhoneEl.value = String(business?.data?.phone || "");
      if (businessPayEl) businessPayEl.value = String(business?.data?.paymentMethods || "");
    } catch (e) {
      console.error(e);
      renderHeader(null);
      currentBusiness = null;
    }
  });

  userForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    const nextName = String(nameEl?.value || "").trim();
    if (!nextName) {
      showFlash("Escribe un nombre válido.", true);
      return;
    }
    try {
      if (userSaveBtn) {
        userSaveBtn.disabled = true;
        userSaveBtn.setAttribute("aria-busy", "true");
      }
      await updateProfile(currentUser, { displayName: nextName });
      showFlash("Perfil actualizado correctamente.");
    } catch (err) {
      console.error(err);
      showFlash("No se pudo guardar el perfil.", true);
    } finally {
      if (userSaveBtn) {
        userSaveBtn.disabled = false;
        userSaveBtn.removeAttribute("aria-busy");
      }
    }
  });

  resetBtn?.addEventListener("click", async () => {
    if (!currentUser?.email) {
      showFlash("Tu cuenta no tiene correo para restablecer contraseña.", true);
      return;
    }
    try {
      resetBtn.disabled = true;
      resetBtn.setAttribute("aria-busy", "true");
      await sendPasswordResetEmail(auth, currentUser.email);
      showFlash(`Te envié un correo para cambiar tu contraseña a ${currentUser.email}.`);
    } catch (err) {
      console.error(err);
      showFlash("No se pudo enviar el correo de restablecimiento.", true);
    } finally {
      resetBtn.disabled = false;
      resetBtn.removeAttribute("aria-busy");
    }
  });

  businessForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentBusiness?.id) {
      showFlash("No encontré un negocio vinculado a tu cuenta.", true);
      return;
    }
    const businessName = String(businessNameEl?.value || "").trim();
    const phone = String(businessPhoneEl?.value || "").trim();
    const paymentMethods = String(businessPayEl?.value || "").trim();
    if (!businessName) {
      showFlash("El nombre del negocio es obligatorio.", true);
      return;
    }
    try {
      if (businessSaveBtn) {
        businessSaveBtn.disabled = true;
        businessSaveBtn.setAttribute("aria-busy", "true");
      }
      await updateDoc(doc(db, "businesses", currentBusiness.id), {
        businessName,
        phone,
        paymentMethods,
        updatedAt: serverTimestamp(),
      });
      currentBusiness.data.businessName = businessName;
      currentBusiness.data.phone = phone;
      currentBusiness.data.paymentMethods = paymentMethods;
      renderHeader(currentBusiness);
      showFlash("Datos del negocio guardados.");
    } catch (err) {
      console.error(err);
      showFlash("No se pudo guardar la configuración del negocio.", true);
    } finally {
      if (businessSaveBtn) {
        businessSaveBtn.disabled = false;
        businessSaveBtn.removeAttribute("aria-busy");
      }
    }
  });

  if (signOutBtn) {
    signOutBtn.addEventListener("click", async () => {
      try {
        clearStoredPrimaryBusiness();
        await signOut(auth);
        window.location.href = "login.html";
      } catch (err) {
        console.error(err);
        openComingSoon("No se pudo cerrar sesión", "Recarga la página e inténtalo de nuevo.");
      }
    });
  }
}

boot();

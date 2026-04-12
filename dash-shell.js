/**
 * Shared dashboard chrome: sidebar mobile menu, coming-soon modal, topbar menu.
 */
import { signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

let modalHost = null;
let modalBackdrop = null;
let modalDialog = null;
let modalTitleEl = null;
let modalDescEl = null;

function ensureModal() {
  if (modalHost) return;

  modalHost = document.createElement("div");
  modalHost.id = "cf-coming-soon-root";
  modalHost.className = "cf-modal-host";
  modalHost.setAttribute("hidden", "");
  modalHost.setAttribute("aria-hidden", "true");

  modalBackdrop = document.createElement("button");
  modalBackdrop.type = "button";
  modalBackdrop.className = "cf-modal-backdrop";
  modalBackdrop.setAttribute("aria-label", "Cerrar");

  modalDialog = document.createElement("div");
  modalDialog.className = "cf-modal-dialog";
  modalDialog.setAttribute("role", "dialog");
  modalDialog.setAttribute("aria-modal", "true");
  modalDialog.setAttribute("aria-labelledby", "cf-coming-soon-title");

  const icon = document.createElement("div");
  icon.className = "cf-modal-icon";
  icon.setAttribute("aria-hidden", "true");

  modalTitleEl = document.createElement("h2");
  modalTitleEl.id = "cf-coming-soon-title";
  modalTitleEl.className = "cf-modal-title";

  modalDescEl = document.createElement("p");
  modalDescEl.className = "cf-modal-desc";

  const actions = document.createElement("div");
  actions.className = "cf-modal-actions";

  const btnClose = document.createElement("button");
  btnClose.type = "button";
  btnClose.className = "cf-modal-btn cf-modal-btn--primary";
  btnClose.textContent = "Entendido";

  btnClose.addEventListener("click", () => closeComingSoon());
  modalBackdrop.addEventListener("click", () => closeComingSoon());

  actions.appendChild(btnClose);
  modalDialog.append(icon, modalTitleEl, modalDescEl, actions);
  modalHost.append(modalBackdrop, modalDialog);
  document.body.appendChild(modalHost);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalHost && !modalHost.hidden) {
      closeComingSoon();
    }
  });
}

export function openComingSoon(title, description) {
  ensureModal();
  if (!modalTitleEl || !modalDescEl || !modalHost) return;

  modalTitleEl.textContent = title || "Próximamente";
  modalDescEl.textContent =
    description ||
    "Estamos terminando esta experiencia para que encaje con el resto de ClientFlow AI.";

  modalHost.hidden = false;
  modalHost.setAttribute("aria-hidden", "false");
  document.body.classList.add("cf-modal-open");
  requestAnimationFrame(() => {
    modalDialog?.querySelector(".cf-modal-btn--primary")?.focus();
  });
}

function closeComingSoon() {
  if (!modalHost) return;
  modalHost.hidden = true;
  modalHost.setAttribute("aria-hidden", "true");
  document.body.classList.remove("cf-modal-open");
}

export function initSidebar() {
  const sidebar = document.getElementById("dash-sidebar");
  const overlay = document.getElementById("dash-sidebar-overlay");
  const menuBtn = document.getElementById("dash-menu-btn");

  function openMenu() {
    if (!sidebar || !menuBtn) return;
    sidebar.classList.add("is-open");
    if (overlay) overlay.hidden = false;
    menuBtn.setAttribute("aria-expanded", "true");
    document.body.classList.add("dash-menu-open");
  }

  function closeMenu() {
    if (!sidebar || !menuBtn) return;
    sidebar.classList.remove("is-open");
    if (overlay) overlay.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("dash-menu-open");
  }

  function toggleMenu() {
    if (sidebar && sidebar.classList.contains("is-open")) closeMenu();
    else openMenu();
  }

  if (menuBtn) menuBtn.addEventListener("click", toggleMenu);
  if (overlay) overlay.addEventListener("click", closeMenu);

  sidebar &&
    sidebar.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        if (window.matchMedia("(max-width: 1024px)").matches) closeMenu();
      });
    });

  window.addEventListener("resize", () => {
    if (window.matchMedia("(min-width: 1025px)").matches) closeMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (document.body.classList.contains("cf-modal-open")) return;
    closeMenu();
  });
}

function bindComingSoonTriggers() {
  document.querySelectorAll("[data-cf-soon]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const title = el.getAttribute("data-cf-soon") || "Próximamente";
      const desc = el.getAttribute("data-cf-soon-desc");
      openComingSoon(title, desc || undefined);
    });
  });
}

function initUserMenu(auth) {
  const avatarBtn = document.querySelector(".dash-avatar");
  const notifyBtn = document.querySelector(".dash-notify");
  if (!avatarBtn) return;

  let wrap = document.querySelector(".dash-user-menu-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "dash-user-menu-wrap";
    avatarBtn.insertAdjacentElement("afterend", wrap);
    wrap.appendChild(avatarBtn);
  }

  let dropdown = wrap.querySelector(".dash-user-dropdown");
  if (!dropdown) {
    dropdown = document.createElement("div");
    dropdown.className = "dash-user-dropdown";
    dropdown.hidden = true;
    dropdown.setAttribute("role", "menu");
    dropdown.innerHTML = `
      <a href="profile.html" class="dash-user-dropdown-item" role="menuitem">Mi perfil</a>
      <a href="configuracion.html" class="dash-user-dropdown-item" role="menuitem">Configuración</a>
      <a href="onboarding.html" class="dash-user-dropdown-item" role="menuitem">Configuración del negocio</a>
      <button type="button" class="dash-user-dropdown-item dash-user-dropdown-item--danger" role="menuitem" data-cf-signout>
        Cerrar sesión
      </button>
    `;
    wrap.appendChild(dropdown);
  }

  function closeDropdown() {
    dropdown.hidden = true;
    avatarBtn.setAttribute("aria-expanded", "false");
  }

  function toggleDropdown() {
    const open = dropdown.hidden;
    dropdown.hidden = !open;
    avatarBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  avatarBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  document.addEventListener("click", () => closeDropdown());
  dropdown.addEventListener("click", (e) => e.stopPropagation());

  const signOutBtn = dropdown.querySelector("[data-cf-signout]");
  if (signOutBtn && auth) {
    signOutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
        window.location.href = "login.html";
      } catch (err) {
        console.error(err);
        openComingSoon("No se pudo cerrar sesión", "Recarga la página e inténtalo de nuevo.");
      }
    });
  }

  if (notifyBtn) {
    notifyBtn.addEventListener("click", () => {
      openComingSoon(
        "Notificaciones",
        "Aquí verás alertas de nuevas solicitudes, campañas y recordatorios. Activaremos el centro de notificaciones en la siguiente iteración.",
      );
    });
  }
}

/**
 * @param {{ auth?: import("https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js").Auth }} opts
 */
export function initDashShell(opts = {}) {
  const { auth } = opts;
  initSidebar();
  bindComingSoonTriggers();
  if (auth) initUserMenu(auth);
}

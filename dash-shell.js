/**
 * Shared dashboard chrome: sidebar mobile menu, coming-soon modal, topbar menu.
 */
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { clearStoredPrimaryBusiness, resolveBusinessForUser } from "./dashboard-data.js";
import { getMenuItemsForCategory } from "./category-config.js";
import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

/** @type {boolean} */
let cfHashNavBound = false;

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

  const nav = sidebar?.querySelector(".dash-nav");
  if (nav && !nav.dataset.cfNavCloseDelegation) {
    nav.dataset.cfNavCloseDelegation = "1";
    nav.addEventListener("click", (e) => {
      if (!e.target.closest("a")) return;
      if (window.matchMedia("(max-width: 1024px)").matches) closeMenu();
    });
  }

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
  const topbarActions = document.querySelector(".dash-topbar-actions");
  if (!avatarBtn || !topbarActions) return;

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
        clearStoredPrimaryBusiness();
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

function fmtDateYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function createCalendarPopoverUi() {
  const wrap = document.createElement("div");
  wrap.className = "dash-cal-pop-wrap";
  wrap.innerHTML = `
    <button type="button" class="dash-icon-btn dash-cal-btn" id="dash-cal-btn" aria-label="Calendario" aria-expanded="false">
      <span class="dash-cal-btn__day"></span>
    </button>
    <div class="dash-cal-pop" id="dash-cal-pop" hidden>
      <div class="dash-cal-pop__head">
        <strong>Calendario</strong>
        <button type="button" class="dash-panel-link" id="dash-cal-close">Cerrar</button>
      </div>
      <div class="dash-cal-mini" id="dash-cal-mini"></div>
      <div class="dash-cal-week-list" id="dash-cal-week-list"></div>
      <div class="dash-cal-pop__actions">
        <button type="button" class="dash-quick-btn" id="dash-cal-add">+ Agregar evento</button>
        <a href="calendario.html" class="dash-quick-btn dash-quick-btn--primary">Ver calendario completo</a>
      </div>
    </div>
    <dialog class="dash-cal-modal" id="dash-cal-modal">
      <form method="dialog" id="dash-cal-form">
        <h3>Nuevo evento</h3>
        <input id="dash-cal-title" class="orders-input" placeholder="Título" required />
        <input id="dash-cal-date" class="orders-input" type="date" required />
        <select id="dash-cal-type" class="orders-input">
          <option value="cita">Cita</option>
          <option value="delivery">Entrega</option>
          <option value="reunion">Reunión</option>
          <option value="recordatorio">Recordatorio</option>
        </select>
        <select id="dash-cal-client" class="orders-input"><option value="">Cliente (opcional)</option></select>
        <textarea id="dash-cal-notes" class="orders-input orders-notes" placeholder="Notas"></textarea>
        <div class="orders-modal-actions">
          <button type="button" class="dash-quick-btn" id="dash-cal-cancel">Cancelar</button>
          <button type="submit" class="dash-quick-btn dash-quick-btn--primary">Guardar</button>
        </div>
      </form>
    </dialog>
  `;
  return wrap;
}

async function initFloatingCalendar(auth, db) {
  const actions = document.querySelector(".dash-topbar-actions");
  if (!actions || !auth || !db) return;
  if (document.getElementById("dash-cal-btn")) return;
  const ui = createCalendarPopoverUi();
  actions.prepend(ui);

  const btn = document.getElementById("dash-cal-btn");
  const dayEl = btn?.querySelector(".dash-cal-btn__day");
  const pop = document.getElementById("dash-cal-pop");
  const close = document.getElementById("dash-cal-close");
  const mini = document.getElementById("dash-cal-mini");
  const weekList = document.getElementById("dash-cal-week-list");
  const addBtn = document.getElementById("dash-cal-add");
  const modal = document.getElementById("dash-cal-modal");
  const form = document.getElementById("dash-cal-form");
  const clientSel = document.getElementById("dash-cal-client");
  const cancelBtn = document.getElementById("dash-cal-cancel");
  if (!btn || !dayEl || !pop || !close || !mini || !weekList || !addBtn || !modal || !form || !clientSel || !cancelBtn) {
    return;
  }
  dayEl.textContent = String(new Date().getDate());

  const user = auth.currentUser;
  if (!user) return;
  const business = await resolveBusinessForUser(db, user);
  const businessId = business?.id;
  if (!businessId) return;

  const calSnap = await getDocs(
    query(collection(db, "businesses", businessId, "calendar"), orderBy("date", "asc"), limit(200)),
  );
  const rows = calSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const firstDow = (monthStart.getDay() + 6) % 7;
  const days = monthEnd.getDate();
  const eventsByDate = new Map();
  rows.forEach((r) => {
    const dt = r.date && typeof r.date.toDate === "function" ? r.date.toDate() : null;
    if (!dt) return;
    const k = fmtDateYmd(dt);
    eventsByDate.set(k, (eventsByDate.get(k) || 0) + 1);
  });
  const grid = [];
  for (let i = 0; i < firstDow; i += 1) grid.push('<span class="dash-cal-mini__empty"></span>');
  for (let d = 1; d <= days; d += 1) {
    const dt = new Date(now.getFullYear(), now.getMonth(), d);
    const k = fmtDateYmd(dt);
    const n = eventsByDate.get(k) || 0;
    const cls = n > 0 ? "dash-cal-mini__day has-event" : "dash-cal-mini__day";
    grid.push(`<span class="${cls}" title="${n > 0 ? `${n} evento(s)` : "Sin eventos"}">${d}</span>`);
  }
  mini.innerHTML = `<div class="dash-cal-mini__month">${now.toLocaleDateString("es", { month: "long", year: "numeric" })}</div><div class="dash-cal-mini__grid">${grid.join("")}</div>`;

  const weekCut = new Date();
  weekCut.setDate(weekCut.getDate() + 7);
  const upcoming = rows
    .map((r) => ({ ...r, _d: r.date && typeof r.date.toDate === "function" ? r.date.toDate() : null }))
    .filter((r) => r._d && r._d >= new Date() && r._d <= weekCut)
    .sort((a, b) => a._d - b._d)
    .slice(0, 7);
  weekList.innerHTML = upcoming.length
    ? upcoming
        .map(
          (r) =>
            `<div class="dash-cal-week-item"><span>${r._d.toLocaleDateString("es", { day: "numeric", month: "short" })}</span><span>${r.title || "Evento"}</span></div>`,
        )
        .join("")
    : '<p class="dash-table-muted">No tienes citas ni entregas programadas.</p>';

  const clientSnap = await getDocs(
    query(collection(db, "businesses", businessId, "clients"), orderBy("createdAt", "desc"), limit(100)),
  );
  clientSnap.forEach((d) => {
    const x = d.data() || {};
    const name = typeof x.fullName === "string" ? x.fullName : typeof x.name === "string" ? x.name : "Cliente";
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = name;
    clientSel.appendChild(opt);
  });

  function closePop() {
    pop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = pop.hidden;
    pop.hidden = !willOpen;
    btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
  });
  close.addEventListener("click", closePop);
  document.addEventListener("click", (e) => {
    if (!ui.contains(e.target)) closePop();
  });

  addBtn.addEventListener("click", () => modal.showModal());
  cancelBtn.addEventListener("click", () => modal.close());
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("dash-cal-title")?.value?.trim();
    const date = document.getElementById("dash-cal-date")?.value;
    const type = document.getElementById("dash-cal-type")?.value || "recordatorio";
    const clientId = document.getElementById("dash-cal-client")?.value || null;
    const notes = document.getElementById("dash-cal-notes")?.value?.trim() || "";
    if (!title || !date) return;
    const dt = new Date(`${date}T12:00:00`);
    await addDoc(collection(db, "businesses", businessId, "calendar"), {
      title,
      date: dt,
      type,
      clientId,
      notes,
      createdAt: serverTimestamp(),
      status: "pending",
    });
    modal.close();
    window.location.reload();
  });
}

/**
 * @param {string} hrefFile
 * @param {string} currentFile
 */
function pathMatchesFile(hrefFile, currentFile) {
  const f = hrefFile.replace(/^\.\//, "").split("#")[0].trim();
  return currentFile === f || currentFile.endsWith(f);
}

/**
 * @param {string} href
 * @param {string} currentPath
 * @param {string} currentHash
 */
function isNavItemActive(href, currentPath, currentHash) {
  const [file, frag] = href.split("#");
  if (!pathMatchesFile(file, currentPath)) return false;
  if (frag) {
    return currentHash === `#${frag}`;
  }
  if (currentPath === "dashboard.html") {
    return currentHash !== "#pedidos";
  }
  return true;
}

/**
 * Marca `is-active` según la ruta y el hash (p. ej. dashboard vs #pedidos).
 * @param {HTMLElement} nav
 */
export function applyActiveNavLink(nav) {
  const path = (window.location.pathname || "").split("/").pop() || "";
  const hash = window.location.hash || "";
  nav.querySelectorAll("a.dash-nav-link").forEach((a) => {
    const href = a.getAttribute("href") || "";
    a.classList.remove("is-active");
    a.removeAttribute("aria-current");
    if (isNavItemActive(href, path, hash)) {
      a.classList.add("is-active");
      a.setAttribute("aria-current", "page");
    }
  });
}

/**
 * @param {import("./category-config.js").CategoryMenuItem[]} items
 */
function renderCategoryNav(items) {
  const nav = document.querySelector("#dash-sidebar .dash-nav");
  if (!nav) return;
  nav.innerHTML = "";
  const path = (window.location.pathname || "").split("/").pop() || "";
  const hash = window.location.hash || "";

  for (const item of items) {
    const a = document.createElement("a");
    a.href = item.href;
    a.className = "dash-nav-link";
    if (item.id === "chat") a.id = "dash-nav-chat-link";
    a.innerHTML = `<span class="dash-nav-ico dash-nav-ico--${item.icon}" aria-hidden="true"></span>
        ${item.name}`;
    if (isNavItemActive(item.href, path, hash)) {
      a.classList.add("is-active");
      a.setAttribute("aria-current", "page");
    }
    nav.appendChild(a);
  }
}

/**
 * @param {import("https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js").Firestore} db
 * @param {import("https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js").User} user
 */
export async function hydrateSidebarCategoryNav(db, user) {
  if (!db || !user) return;
  try {
    const business = await resolveBusinessForUser(db, user);
    const cat = business?.data && /** @type {Record<string, unknown>} */ (business.data).category;
    const items = getMenuItemsForCategory(cat);
    if (items && items.length) {
      renderCategoryNav(items);
    } else {
      ensureChatNavLink();
      const nav = document.querySelector("#dash-sidebar .dash-nav");
      if (nav) applyActiveNavLink(nav);
    }
  } catch (e) {
    console.warn("[DashShell] category nav", e);
    ensureChatNavLink();
    const nav = document.querySelector("#dash-sidebar .dash-nav");
    if (nav) applyActiveNavLink(nav);
  }
}

/**
 * Inserta «Chat IA» tras «Campañas IA» si no existe; marca activo en `chat.html`.
 */
export function ensureChatNavLink() {
  const nav = document.querySelector("#dash-sidebar .dash-nav");
  if (!nav) return;
  let chatLink = nav.querySelector('a[href="chat.html"]');
  if (!chatLink) {
    chatLink = document.createElement("a");
    chatLink.id = "dash-nav-chat-link";
    chatLink.href = "chat.html";
    chatLink.className = "dash-nav-link";
    chatLink.innerHTML = `<span class="dash-nav-ico dash-nav-ico--chat" aria-hidden="true"></span>
        Chat IA`;
    const camp = nav.querySelector('a[href="campanas.html"]');
    if (camp && camp.nextSibling) {
      camp.parentNode.insertBefore(chatLink, camp.nextSibling);
    } else if (camp) {
      camp.parentNode.appendChild(chatLink);
    } else {
      nav.appendChild(chatLink);
    }
  }
  applyActiveNavLink(nav);
}

/**
 * @param {{ auth?: import("https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js").Auth }} opts
 */
export function initDashShell(opts = {}) {
  const { auth, db } = opts;
  if (!cfHashNavBound) {
    cfHashNavBound = true;
    window.addEventListener("hashchange", () => {
      const n = document.querySelector("#dash-sidebar .dash-nav");
      if (n) applyActiveNavLink(n);
    });
  }

  ensureChatNavLink();
  initSidebar();
  bindComingSoonTriggers();
  if (auth) initUserMenu(auth);
  if (auth && db) {
    void initFloatingCalendar(auth, db);
  }

  if (auth && db) {
    onAuthStateChanged(auth, (user) => {
      if (user) void hydrateSidebarCategoryNav(db, user);
    });
  } else if (auth) {
    const nav = document.querySelector("#dash-sidebar .dash-nav");
    if (nav) applyActiveNavLink(nav);
  }
}

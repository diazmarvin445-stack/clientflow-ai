/**
 * Shared dashboard chrome: sidebar mobile menu, coming-soon modal, topbar menu.
 */
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  clearStoredPrimaryBusiness,
  resolveBusinessForUser,
  fetchBusinessesForOwnerList,
  setSessionPrimaryBusinessId,
} from "./dashboard-data.js";
import { getMenuItemsForCategory } from "./category-config.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

/** @type {boolean} */
let cfHashNavBound = false;

let modalHost = null;
let modalBackdrop = null;
let modalDialog = null;
let modalTitleEl = null;
let modalDescEl = null;
const THEME_KEY = "cf_theme";

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
  const nav = sidebar?.querySelector(".dash-nav");

  ensureClientesNavLink();

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

function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.body.classList.remove("light-theme", "dark-theme");
  document.body.classList.add(t === "light" ? "light-theme" : "dark-theme");
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {}
  return t;
}

function readStoredTheme() {
  try {
    const x = localStorage.getItem(THEME_KEY);
    return x === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function initThemeToggle() {
  const actions = document.querySelector(".dash-topbar-actions");
  if (!actions) return;
  let btn = document.getElementById("dash-theme-toggle");
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "dash-theme-toggle";
    btn.className = "dash-icon-btn dash-theme-toggle";
    actions.insertBefore(btn, actions.firstChild);
  }

  function syncUi(theme) {
    const dark = theme !== "light";
    btn.textContent = dark ? "🌙" : "☀️";
    btn.setAttribute("aria-label", dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro");
    btn.setAttribute("title", dark ? "Tema oscuro activo" : "Tema claro activo");
  }

  const initial = applyTheme(readStoredTheme());
  syncUi(initial);
  btn.addEventListener("click", () => {
    const current = document.body.classList.contains("light-theme") ? "light" : "dark";
    const next = current === "dark" ? "light" : "dark";
    const applied = applyTheme(next);
    syncUi(applied);
  });
}

function initUserMenu(auth, db) {
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
      <div class="dash-user-business-switch" data-cf-business-switch-wrap hidden>
        <p class="dash-user-business-switch__title">Negocio activo</p>
        <div class="dash-user-business-switch__list" data-cf-business-switch-list></div>
      </div>
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
  const switchWrap = dropdown.querySelector("[data-cf-business-switch-wrap]");
  const switchList = dropdown.querySelector("[data-cf-business-switch-list]");

  if (auth && db && switchWrap && switchList) {
    onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      try {
        const [allBusinesses, activeBusiness] = await Promise.all([
          fetchBusinessesForOwnerList(db, user.uid),
          resolveBusinessForUser(db, user),
        ]);
        if (!Array.isArray(allBusinesses) || allBusinesses.length <= 1) {
          switchWrap.hidden = true;
          switchList.innerHTML = "";
          return;
        }
        switchWrap.hidden = false;
        switchList.innerHTML = "";
        for (const row of allBusinesses) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "dash-user-business-switch__btn";
          if (activeBusiness?.id === row.id) btn.classList.add("is-active");
          const name = String(row.data?.businessName || "Negocio");
          const cat = String(row.data?.businessCategory || row.data?.category || "").trim();
          btn.textContent = cat ? `${name} · ${cat}` : name;
          btn.addEventListener("click", () => {
            setSessionPrimaryBusinessId(user.uid, row.id);
            window.location.reload();
          });
          switchList.appendChild(btn);
        }
      } catch (e) {
        console.warn("[DashShell] business switcher", e);
      }
    });
  }
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
      <div class="dash-cal-nav">
        <button type="button" class="dash-panel-link" id="dash-cal-prev" aria-label="Mes anterior">&lt;</button>
        <div class="dash-cal-nav__center">
          <div class="dash-cal-nav__label" id="dash-cal-month-label"></div>
          <button type="button" class="dash-panel-link dash-cal-nav__today" id="dash-cal-today">Hoy</button>
        </div>
        <button type="button" class="dash-panel-link" id="dash-cal-next" aria-label="Mes siguiente">&gt;</button>
      </div>
      <div class="dash-cal-mini-wrap">
        <div class="dash-cal-mini" id="dash-cal-mini" aria-label="Calendario mensual"></div>
        <div class="dash-cal-day-pop" id="dash-cal-day-pop" hidden></div>
      </div>
      <div class="dash-cal-pop__actions">
        <button type="button" class="dash-quick-btn" id="dash-cal-add">+ Agregar evento</button>
      </div>
    </div>
    <dialog class="dash-cal-modal" id="dash-cal-modal">
      <form method="dialog" id="dash-cal-form">
        <input type="hidden" id="dash-cal-edit-id" value="" />
        <h3 id="dash-cal-modal-title">Nuevo evento</h3>
        <input id="dash-cal-title" class="orders-input" placeholder="Título" required />
        <input id="dash-cal-date" class="orders-input" type="date" required />
        <input id="dash-cal-time" class="orders-input" type="time" />
        <select id="dash-cal-type" class="orders-input">
          <option value="cita">Cita</option>
          <option value="entrega">Entrega</option>
          <option value="reunion">Reunión</option>
          <option value="recordatorio">Recordatorio</option>
        </select>
        <input id="dash-cal-client-desc" class="orders-input" aria-label="Descripción / Cliente (opcional)" placeholder="Ej: Cita con proveedor, revisión pedido, etc." />
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
  const prevBtn = document.getElementById("dash-cal-prev");
  const nextBtn = document.getElementById("dash-cal-next");
  const todayNavBtn = document.getElementById("dash-cal-today");
  const monthLabel = document.getElementById("dash-cal-month-label");
  const mini = document.getElementById("dash-cal-mini");
  const dayPop = document.getElementById("dash-cal-day-pop");
  const addBtn = document.getElementById("dash-cal-add");
  const modal = document.getElementById("dash-cal-modal");
  const form = document.getElementById("dash-cal-form");
  const modalTitleEl = document.getElementById("dash-cal-modal-title");
  const editIdInput = document.getElementById("dash-cal-edit-id");
  const clientDescInput = document.getElementById("dash-cal-client-desc");
  const cancelBtn = document.getElementById("dash-cal-cancel");
  if (
    !btn ||
    !dayEl ||
    !pop ||
    !close ||
    !prevBtn ||
    !nextBtn ||
    !todayNavBtn ||
    !monthLabel ||
    !mini ||
    !dayPop ||
    !addBtn ||
    !modal ||
    !form ||
    !modalTitleEl ||
    !editIdInput ||
    !clientDescInput ||
    !cancelBtn
  ) {
    return;
  }
  dayEl.textContent = String(new Date().getDate());

  const user = auth.currentUser;
  if (!user) return;
  const business = await resolveBusinessForUser(db, user);
  const businessId = business?.id;
  if (!businessId) return;

  let monthCursor = new Date();
  /** @type {{ id: string, [k: string]: unknown }[]} */
  let calendarRows = [];

  function parseEventDate(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") {
      const dt = value.toDate();
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  function mapType(raw) {
    const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!v) return "recordatorio";
    if (v === "delivery") return "entrega";
    if (v === "meeting") return "reunion";
    return v;
  }

  /** @param {string} t */
  function dotClassForType(t) {
    const m = mapType(String(t || ""));
    if (m === "entrega") return "dash-cal-dot dash-cal-dot--entrega";
    if (m === "cita") return "dash-cal-dot dash-cal-dot--cita";
    if (m === "reunion") return "dash-cal-dot dash-cal-dot--reunion";
    return "dash-cal-dot dash-cal-dot--recordatorio";
  }

  function closeDayPop() {
    dayPop.hidden = true;
    dayPop.innerHTML = "";
  }

  /** Agrupa eventos por YYYY-MM-DD con orden dentro del día. */
  function eventsByYmd(rows) {
    /** @type {Map<string, { id: string, [k: string]: unknown }[]>} */
    const map = new Map();
    for (const r of rows) {
      const dt = parseEventDate(r.date);
      if (!dt) continue;
      const k = fmtDateYmd(dt);
      const list = map.get(k) || [];
      list.push(r);
      map.set(k, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => {
        const ta = typeof a.time === "string" ? a.time : "";
        const tb = typeof b.time === "string" ? b.time : "";
        if (ta !== tb) return ta.localeCompare(tb);
        return String(a.title || "").localeCompare(String(b.title || ""));
      });
    }
    return map;
  }

  function openAddModal(dateYmd, editEvent) {
    editIdInput.value = editEvent?.id ? String(editEvent.id) : "";
    modalTitleEl.textContent = editEvent?.id ? "Editar evento" : "Nuevo evento";
    document.getElementById("dash-cal-title").value = editEvent?.title ? String(editEvent.title) : "";
    document.getElementById("dash-cal-date").value = dateYmd || fmtDateYmd(new Date());
    document.getElementById("dash-cal-time").value = editEvent?.time ? String(editEvent.time) : "";
    const selType = mapType(String(editEvent?.type || "cita"));
    document.getElementById("dash-cal-type").value =
      selType === "entrega" || selType === "cita" || selType === "reunion" || selType === "recordatorio"
        ? selType
        : "cita";
    document.getElementById("dash-cal-notes").value = editEvent?.notes ? String(editEvent.notes) : "";
    clientDescInput.value = editEvent?.clientName ? String(editEvent.clientName) : "";
    modal.showModal();
    closeDayPop();
  }

  function renderCalendar() {
    const rows = calendarRows;
    const now = new Date();
    const monthStart = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
    const monthEnd = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0);
    monthLabel.textContent = monthStart.toLocaleDateString("es", { month: "long", year: "numeric" });
    const firstDow = (monthStart.getDay() + 6) % 7;
    const days = monthEnd.getDate();
    const byDay = eventsByYmd(rows);
    const todayYmd = fmtDateYmd(now);

    const grid = [];
    const prevMonthEnd = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 0);
    const prevMonthDays = prevMonthEnd.getDate();
    for (let i = 0; i < firstDow; i += 1) {
      const dayNum = prevMonthDays - firstDow + i + 1;
      const cellDate = new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, dayNum);
      const k = fmtDateYmd(cellDate);
      const dayEvents = byDay.get(k) || [];
      const dots = dayEvents
        .slice(0, 3)
        .map((ev) => `<span class="${dotClassForType(ev.type)}" aria-hidden="true"></span>`)
        .join("");
      grid.push(`<button type="button" class="dash-cal-day dash-cal-day--outside${dayEvents.length ? " dash-cal-day--has-events" : ""}" data-cal-ymd="${k}" aria-label="Día ${dayNum}, mes anterior${dayEvents.length ? `, ${dayEvents.length} evento(s)` : ""}">
        <span class="dash-cal-day__num">${dayNum}</span>
        <span class="dash-cal-day__dots" aria-hidden="true">${dots}</span>
      </button>`);
    }
    for (let d = 1; d <= days; d += 1) {
      const cellDate = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), d);
      const k = fmtDateYmd(cellDate);
      const dayEvents = byDay.get(k) || [];
      const isToday = k === todayYmd;
      const hasEv = dayEvents.length > 0;
      const dots = [];
      const maxDots = 5;
      for (let i = 0; i < Math.min(dayEvents.length, maxDots); i += 1) {
        dots.push(`<span class="${dotClassForType(dayEvents[i].type)}" aria-hidden="true"></span>`);
      }
      if (dayEvents.length > maxDots) {
        dots.push(`<span class="dash-cal-dot-more">+${dayEvents.length - maxDots}</span>`);
      }
      const dayClasses = ["dash-cal-day"];
      if (isToday) dayClasses.push("dash-cal-day--today");
      if (hasEv) dayClasses.push("dash-cal-day--has-events");
      grid.push(`<button type="button" class="${dayClasses.join(" ")}" data-cal-ymd="${k}" aria-label="Día ${d}${hasEv ? `, ${dayEvents.length} evento(s)` : ""}">
        <span class="dash-cal-day__num">${d}</span>
        <span class="dash-cal-day__dots" aria-hidden="true">${dots.join("")}</span>
      </button>`);
    }
    const totalCells = firstDow + days;
    const trailing = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= trailing; i += 1) {
      const cellDate = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, i);
      const k = fmtDateYmd(cellDate);
      const dayEvents = byDay.get(k) || [];
      const dots = dayEvents
        .slice(0, 3)
        .map((ev) => `<span class="${dotClassForType(ev.type)}" aria-hidden="true"></span>`)
        .join("");
      grid.push(`<button type="button" class="dash-cal-day dash-cal-day--outside${dayEvents.length ? " dash-cal-day--has-events" : ""}" data-cal-ymd="${k}" aria-label="Día ${i}, mes siguiente${dayEvents.length ? `, ${dayEvents.length} evento(s)` : ""}">
        <span class="dash-cal-day__num">${i}</span>
        <span class="dash-cal-day__dots" aria-hidden="true">${dots}</span>
      </button>`);
    }
    mini.innerHTML = `<div class="dash-cal-mini__grid">${grid.join("")}</div>`;

    mini.querySelectorAll("button[data-cal-ymd]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const ymd = el.getAttribute("data-cal-ymd");
        if (!ymd) return;
        const list = byDay.get(ymd) || [];
        if (list.length === 0) {
          openAddModal(ymd, null);
          return;
        }
        const anchor = /** @type {HTMLElement} */ (el);
        const rect = anchor.getBoundingClientRect();
        const popRect = pop.getBoundingClientRect();
        const top = rect.bottom - popRect.top + 4;
        const left = Math.min(Math.max(rect.left - popRect.left - 4, 0), popRect.width - 220);
        const lines = list
          .map((evRow) => {
            const t = typeof evRow.time === "string" && evRow.time ? `${evRow.time} · ` : "";
            const cli =
              typeof evRow.clientName === "string" && evRow.clientName.trim()
                ? ` · ${evRow.clientName.trim()}`
                : "";
            return `<div class="dash-cal-day-pop__row" data-ev-id="${evRow.id}">
              <div class="dash-cal-day-pop__main"><span class="dash-cal-day-pop__time">${t}</span>${evRow.title || "Evento"}${cli}</div>
              <div class="dash-cal-day-pop__acts">
                <button type="button" class="dash-panel-link" data-cal-pop-edit="${evRow.id}">Editar</button>
                <button type="button" class="dash-panel-link" data-cal-pop-done="${evRow.id}">Completar</button>
                <button type="button" class="dash-panel-link" data-cal-pop-del="${evRow.id}">Eliminar</button>
              </div>
            </div>`;
          })
          .join("");
        dayPop.innerHTML = `<div class="dash-cal-day-pop__inner">
          <div class="dash-cal-day-pop__head"><strong>${new Date(ymd + "T12:00:00").toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short" })}</strong>
          <button type="button" class="dash-panel-link" id="dash-cal-day-pop-close">Cerrar</button></div>
          <div class="dash-cal-day-pop__list">${lines}</div>
          <button type="button" class="dash-quick-btn" id="dash-cal-day-pop-add">+ Agregar otro evento para este día</button>
        </div>`;
        dayPop.hidden = false;
        dayPop.style.top = `${top}px`;
        dayPop.style.left = `${left}px`;

        dayPop.querySelector("#dash-cal-day-pop-close")?.addEventListener("click", (e) => {
          e.stopPropagation();
          closeDayPop();
        });
        dayPop.querySelector("#dash-cal-day-pop-add")?.addEventListener("click", (e) => {
          e.stopPropagation();
          openAddModal(ymd, null);
        });
        dayPop.querySelectorAll("[data-cal-pop-edit]").forEach((b) => {
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = b.getAttribute("data-cal-pop-edit");
            const row = list.find((x) => x.id === id);
            if (row) openAddModal(ymd, row);
          });
        });
        dayPop.querySelectorAll("[data-cal-pop-done]").forEach((b) => {
          b.addEventListener("click", async (e) => {
            e.stopPropagation();
            const id = b.getAttribute("data-cal-pop-done");
            if (!id) return;
            await updateDoc(doc(db, "businesses", businessId, "calendar", id), {
              status: "completed",
              completedAt: serverTimestamp(),
            });
            closeDayPop();
          });
        });
        dayPop.querySelectorAll("[data-cal-pop-del]").forEach((b) => {
          b.addEventListener("click", async (e) => {
            e.stopPropagation();
            const id = b.getAttribute("data-cal-pop-del");
            if (!id) return;
            await deleteDoc(doc(db, "businesses", businessId, "calendar", id));
            closeDayPop();
          });
        });
      });
    });
  }

  const calQuery = query(collection(db, "businesses", businessId, "calendar"), orderBy("date", "asc"), limit(400));
  onSnapshot(
    calQuery,
    (snap) => {
      calendarRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      closeDayPop();
      renderCalendar();
    },
    (err) => console.warn("[DashShell] calendar snapshot", err),
  );

  renderCalendar();

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
  pop.addEventListener("click", (e) => e.stopPropagation());
  const miniWrap = mini.closest(".dash-cal-mini-wrap");
  if (miniWrap) {
    miniWrap.addEventListener("click", (e) => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (!t.closest(".dash-cal-day") && !t.closest(".dash-cal-day-pop")) closeDayPop();
    });
  }
  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeDayPop();
    monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1);
    renderCalendar();
  });
  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeDayPop();
    monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1);
    renderCalendar();
  });
  todayNavBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeDayPop();
    monthCursor = new Date();
    renderCalendar();
  });
  document.addEventListener("click", (e) => {
    if (!ui.contains(e.target)) closePop();
  });

  addBtn.addEventListener("click", () => {
    openAddModal(fmtDateYmd(new Date()), null);
  });
  modal.addEventListener("close", () => {
    editIdInput.value = "";
    modalTitleEl.textContent = "Nuevo evento";
  });
  cancelBtn.addEventListener("click", () => {
    editIdInput.value = "";
    modal.close();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("dash-cal-title")?.value?.trim();
    const date = document.getElementById("dash-cal-date")?.value;
    const time = document.getElementById("dash-cal-time")?.value?.trim() || "";
    const type = mapType(document.getElementById("dash-cal-type")?.value || "recordatorio");
    const clientName = document.getElementById("dash-cal-client-desc")?.value?.trim() || null;
    const clientId = null;
    const notes = document.getElementById("dash-cal-notes")?.value?.trim() || "";
    if (!title || !date) return;
    const dt = new Date(`${date}T${time || "12:00"}:00`);
    const editId = editIdInput.value?.trim();
    if (editId) {
      await updateDoc(doc(db, "businesses", businessId, "calendar", editId), {
        title,
        date: Timestamp.fromDate(dt),
        time: time || "",
        type,
        clientId,
        clientName,
        notes,
      });
    } else {
      await addDoc(collection(db, "businesses", businessId, "calendar"), {
        title,
        date: Timestamp.fromDate(dt),
        time: time || "",
        type,
        clientId,
        clientName,
        notes,
        createdBy: "marvin",
        createdAt: serverTimestamp(),
        status: "pending",
      });
    }
    form.reset();
    editIdInput.value = "";
    modalTitleEl.textContent = "Nuevo evento";
    modal.close();
    monthCursor = new Date(dt.getFullYear(), dt.getMonth(), 1);
    closeDayPop();
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
  ensureClientesNavLink();
  applyActiveNavLink(nav);
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
    const dash = nav.querySelector('a[href="dashboard.html"]');
    if (dash && dash.nextSibling) {
      dash.parentNode.insertBefore(chatLink, dash.nextSibling);
    } else if (dash) {
      dash.parentNode.appendChild(chatLink);
    } else {
      nav.insertBefore(chatLink, nav.firstChild);
    }
  }
  applyActiveNavLink(nav);
}

/**
 * Inserta «Clientes» justo debajo de «Pedidos» si no existe.
 * Debe funcionar tanto para nav HTML estático como para nav renderizado por categoría.
 */
export function ensureClientesNavLink() {
  const nav = document.querySelector("#dash-sidebar .dash-nav");
  if (!nav) return;
  let clientesLink = nav.querySelector('a[href="clientes.html"]');
  if (!clientesLink) {
    clientesLink = document.createElement("a");
    clientesLink.href = "clientes.html";
    clientesLink.className = "dash-nav-link";
    clientesLink.innerHTML = `<span class="dash-nav-ico dash-nav-ico--team" aria-hidden="true"></span>
        Clientes`;
  }
  const pedidosLink = nav.querySelector('a[href="pedidos.html"]');
  const afterPedidos = pedidosLink?.nextElementSibling;
  if (pedidosLink) {
    if (afterPedidos !== clientesLink) {
      nav.insertBefore(clientesLink, afterPedidos || null);
    }
  } else if (!clientesLink.parentElement) {
    nav.prepend(clientesLink);
  }
  applyActiveNavLink(nav);
}

/**
 * Inserta/oculta «Diagnóstico» (solo dueño/admin del negocio).
 * @param {boolean} canAccess
 */
export function ensureDiagnosticsNavLink(canAccess) {
  const nav = document.querySelector("#dash-sidebar .dash-nav");
  if (!nav) return;
  let diagLink = nav.querySelector('a[href="diagnostico.html"]');

  if (!canAccess) {
    if (diagLink) diagLink.remove();
    applyActiveNavLink(nav);
    return;
  }

  if (!diagLink) {
    diagLink = document.createElement("a");
    diagLink.href = "diagnostico.html";
    diagLink.className = "dash-nav-link";
    diagLink.innerHTML = `<span class="dash-nav-ico dash-nav-ico--gear" aria-hidden="true"></span>
        Diagnóstico`;
  }
  const configLink = nav.querySelector('a[href="configuracion.html"]');
  if (configLink) {
    nav.insertBefore(diagLink, configLink);
  } else if (!diagLink.parentElement) {
    nav.appendChild(diagLink);
  }
  applyActiveNavLink(nav);
}

/**
 * @param {{ auth?: import("https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js").Auth }} opts
 */
export function initDashShell(opts = {}) {
  const { auth, db } = opts;
  applyTheme(readStoredTheme());
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
  initThemeToggle();
  if (auth) initUserMenu(auth, db);
  if (auth && db) {
    onAuthStateChanged(auth, (user) => {
      if (user) {
        void hydrateSidebarCategoryNav(db, user).then(async () => {
          try {
            const business = await resolveBusinessForUser(db, user);
            const ownerUid =
              business && business.data && typeof business.data.ownerUid === "string"
                ? business.data.ownerUid.trim()
                : "";
            ensureDiagnosticsNavLink(Boolean(ownerUid) && ownerUid === user.uid);
          } catch (err) {
            console.warn("[DashShell] diagnostics nav", err);
            ensureDiagnosticsNavLink(false);
          }
        });
        void initFloatingCalendar(auth, db);
      }
    });
  } else if (auth) {
    const nav = document.querySelector("#dash-sidebar .dash-nav");
    if (nav) applyActiveNavLink(nav);
  }
}

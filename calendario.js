import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { fetchBusinessForOwner, formatBusinessMeta, initialsFromName } from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";

function renderHeader(business) {
  const nameEl = document.getElementById("dash-business-name");
  const metaEl = document.getElementById("dash-business-meta");
  const av = document.getElementById("dash-avatar-initials");

  if (!business) {
    if (nameEl) nameEl.textContent = "Tu negocio";
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

function startOfMonday(d) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function formatRangeEs(start, end) {
  const opts = { day: "numeric", month: "short" };
  const a = start.toLocaleDateString("es", opts);
  const b = end.toLocaleDateString("es", { ...opts, year: "numeric" });
  return `${a} — ${b}`;
}

function renderWeekCalendar() {
  const root = document.getElementById("cal-week-days");
  const rangeEl = document.getElementById("cal-week-range");
  const hint = document.getElementById("cal-week-hint");
  if (!root) return;

  const today = new Date();
  const mon = startOfMonday(today);
  const sun = addDays(mon, 6);

  if (rangeEl) rangeEl.textContent = formatRangeEs(mon, sun);

  root.replaceChildren();
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(mon, i);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dash-cal-day";
    btn.textContent = String(day.getDate());
    btn.setAttribute(
      "aria-label",
      day.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" }),
    );
    const isToday =
      day.getFullYear() === today.getFullYear() &&
      day.getMonth() === today.getMonth() &&
      day.getDate() === today.getDate();
    if (isToday) btn.classList.add("is-today");
    btn.addEventListener("click", () => {
      if (hint) {
        hint.textContent = `Día seleccionado: ${day.toLocaleDateString("es", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}. Las reservas en tiempo real llegarán en una próxima versión.`;
      }
    });
    root.appendChild(btn);
  }
}

function renderPlaceholderAppointments() {
  const list = document.getElementById("cal-appt-list");
  const badge = document.getElementById("cal-appt-count");
  if (!list) return;

  list.replaceChildren();
  const li = document.createElement("li");
  li.className = "dash-appt dash-appt--solo";
  li.innerHTML = `
    <div class="dash-appt-body">
      <span class="dash-appt-title">Aún no hay citas sincronizadas</span>
      <span class="dash-appt-meta">Cuando conectes tu calendario o confirmes visitas desde solicitudes, aparecerán aquí.</span>
    </div>`;
  list.appendChild(li);

  const more = document.createElement("li");
  more.className = "dash-appt dash-appt--more";
  more.innerHTML = `<button type="button" class="dash-appt-link" data-cf-soon="Agenda completa" data-cf-soon-desc="Sincronización con Google Calendar y recordatorios automáticos estarán disponibles pronto.">Ver agenda completa</button>`;
  list.appendChild(more);

  if (badge) badge.textContent = "0";
}

async function loadCalendarioForUser(user) {
  const business = await fetchBusinessForOwner(db, user.uid);
  renderHeader(business);
  renderWeekCalendar();
  renderPlaceholderAppointments();
}

function boot() {
  initDashShell({ auth });

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    loadCalendarioForUser(user).catch((err) => {
      console.error(err);
      renderHeader(null);
      renderWeekCalendar();
      renderPlaceholderAppointments();
    });
  });
}

boot();

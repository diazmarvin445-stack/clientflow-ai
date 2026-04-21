import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  resolveBusinessForUser,
  fetchJobsForBusiness,
  formatBusinessMeta,
  initialsFromName,
} from "./dashboard-data.js";
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

function toMaybeDate(val) {
  if (val == null) return null;
  if (typeof val.toDate === "function") {
    try {
      const d = val.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
  return null;
}

function renderWeekCalendar(jobsWithDelivery) {
  const root = document.getElementById("cal-week-days");
  const rangeEl = document.getElementById("cal-week-range");
  const hint = document.getElementById("cal-week-hint");
  if (!root) return;

  const today = new Date();
  const mon = startOfMonday(today);
  const sun = addDays(mon, 6);

  if (rangeEl) rangeEl.textContent = formatRangeEs(mon, sun);

  const deliveryByDay = new Map();
  for (const j of jobsWithDelivery) {
    const d = j._delivery;
    if (!d) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    deliveryByDay.set(key, (deliveryByDay.get(key) || 0) + 1);
  }

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

    const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
    const n = deliveryByDay.get(key) || 0;
    if (n > 0) {
      btn.classList.add("has-delivery");
      btn.title = `${n} entrega(s) programada(s)`;
    }

    btn.addEventListener("click", () => {
      if (hint) {
        const count = n;
        hint.textContent = count
          ? `${count} orden(es) con entrega este día (desde Chat IA u órdenes guardadas).`
          : `Día seleccionado: ${day.toLocaleDateString("es", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}. Sin entregas programadas.`;
      }
    });
    root.appendChild(btn);
  }
}

function renderAppointmentsFromJobs(jobs) {
  const list = document.getElementById("cal-appt-list");
  const badge = document.getElementById("cal-appt-count");
  if (!list) return;

  const enriched = jobs
    .map((row) => {
      const delivery = toMaybeDate(row.deliveryDate);
      return { ...row, _delivery: delivery };
    })
    .filter((row) => row._delivery)
    .sort((a, b) => {
      const ta = a._delivery.getTime();
      const tb = b._delivery.getTime();
      return ta - tb;
    });

  list.replaceChildren();

  if (!enriched.length) {
    const li = document.createElement("li");
    li.className = "dash-appt dash-appt--solo";
    li.innerHTML = `
    <div class="dash-appt-body">
      <span class="dash-appt-title">Sin entregas programadas</span>
      <span class="dash-appt-meta">Las órdenes creadas desde Chat IA aparecerán aquí con su fecha de entrega (+12 días).</span>
    </div>`;
    list.appendChild(li);
    if (badge) badge.textContent = "0";
    return;
  }

  if (badge) badge.textContent = String(enriched.length);

  for (const row of enriched) {
    const d = row._delivery;
    const li = document.createElement("li");
    li.className = "dash-appt dash-appt--delivery";

    const timeEl = document.createElement("div");
    timeEl.className = "dash-appt-time";
    timeEl.textContent = d.toLocaleDateString("es", { day: "numeric", month: "short" });

    const body = document.createElement("div");
    body.className = "dash-appt-body";

    const title = document.createElement("span");
    title.className = "dash-appt-title";
    const st = typeof row.status === "string" ? row.status : "";
    const titleText =
      (typeof row.title === "string" && row.title.trim()) ||
      (typeof row.productKey === "string" ? `Orden ${row.productKey}` : "Orden");
    title.textContent = titleText;

    const meta = document.createElement("span");
    meta.className = "dash-appt-meta";
    const statusLabel = st === "Pendiente" ? "Pendiente" : st || "Orden";
    const when =
      typeof row.estimatedDeliveryLabel === "string" && row.estimatedDeliveryLabel.trim()
        ? row.estimatedDeliveryLabel.trim()
        : d.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
    meta.textContent = `${statusLabel} · Entrega: ${when}`;
    if (row.source === "chat-ai") {
      meta.textContent += " · Chat IA";
    }

    body.append(title, meta);
    li.append(timeEl, body);
    list.appendChild(li);
  }
}

async function loadCalendarioForUser(user) {
  const business = await resolveBusinessForUser(db, user);
  renderHeader(business);

  let jobs = [];
  if (business) {
    try {
      jobs = await fetchJobsForBusiness(db, business.id);
    } catch (e) {
      console.warn("[Calendario] jobs", e);
    }
  }

  const withDelivery = jobs
    .map((row) => {
      const delivery = toMaybeDate(row.deliveryDate);
      return { ...row, _delivery: delivery };
    })
    .filter((row) => row._delivery);

  renderWeekCalendar(withDelivery);
  renderAppointmentsFromJobs(jobs);

  const hint = document.getElementById("cal-week-hint");
  if (hint && withDelivery.length) {
    hint.textContent =
      "Los días con punto indican al menos una entrega programada. Creado desde Chat IA: +12 días al convertir a orden.";
  }
}

function boot() {
  initDashShell({ auth, db });

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    loadCalendarioForUser(user).catch((err) => {
      console.error(err);
      renderHeader(null);
      renderWeekCalendar([]);
      renderAppointmentsFromJobs([]);
    });
  });
}

boot();

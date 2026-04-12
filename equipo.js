import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  fetchBusinessForOwner,
  fetchTeamMembersForBusiness,
  formatBusinessMeta,
  initialsFromName,
} from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";

/** @type {string | null} */
let businessId = null;
/** @type {Record<string, unknown>[]} */
let members = [];

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_SHORT_ES = {
  mon: "Lun",
  tue: "Mar",
  wed: "Mié",
  thu: "Jue",
  fri: "Vie",
  sat: "Sáb",
  sun: "Dom",
};

function todayCode() {
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[new Date().getDay()];
}

function renderHeader(business) {
  const nameEl = document.getElementById("dash-business-name");
  const metaEl = document.getElementById("dash-business-meta");
  const av = document.getElementById("dash-avatar-initials");

  if (!business) {
    if (nameEl) nameEl.textContent = "Equipo";
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

function showLoadError(msg) {
  const el = document.getElementById("eq-load-error");
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function telHref(phone) {
  const s = typeof phone === "string" ? phone.trim() : "";
  if (!s) return null;
  const cleaned = s.replace(/[^\d+]/g, "");
  return cleaned ? `tel:${cleaned}` : null;
}

function normalizeWorkDays(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((d) => typeof d === "string" && DAY_ORDER.includes(d));
}

function normalizeCategory(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s === "administrativo" || s === "operativo") return s;
  return "operativo";
}

function formatDaysLabel(days) {
  const list = normalizeWorkDays(days);
  if (!list.length) return "—";
  const ordered = DAY_ORDER.filter((d) => list.includes(d));
  return ordered.map((d) => DAY_SHORT_ES[d] || d).join(" · ");
}

function formatTimeRange(from, to) {
  const a = typeof from === "string" ? from.trim() : "";
  const b = typeof to === "string" ? to.trim() : "";
  if (!a && !b) return "—";
  if (a && b) return `${a} – ${b}`;
  return a || b;
}

function isActiveToday(m) {
  const active = m.active !== false;
  if (!active) return false;
  const days = normalizeWorkDays(m.workDays);
  if (!days.length) return false;
  return days.includes(todayCode());
}

function computeStats(list) {
  let activeToday = 0;
  let operativo = 0;
  let admin = 0;
  for (const m of list) {
    if (isActiveToday(m)) activeToday += 1;
    const cat = normalizeCategory(m.staffCategory);
    if (cat === "administrativo") admin += 1;
    else operativo += 1;
  }
  return {
    total: list.length,
    activeToday,
    operativo,
    admin,
  };
}

function setPanelMeta(count) {
  const el = document.getElementById("eq-panel-meta");
  if (!el) return;
  if (count === 0) {
    el.textContent = "Cuando agregues personas aparecerán aquí con su información.";
    return;
  }
  el.textContent = `${count} ${count === 1 ? "persona en el equipo" : "personas en el equipo"}`;
}

function renderEmpty(root) {
  root.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "eq-empty";
  wrap.innerHTML =
    '<div class="dash-leads-empty-icon" aria-hidden="true"></div>' +
    '<p class="dash-leads-empty-title">Aún no tienes miembros en tu equipo.</p>' +
    '<p class="dash-leads-empty-text">Agrega empleados o colaboradores para organizar mejor tu operación.</p>';
  root.appendChild(wrap);
}

function renderMemberCard(m) {
  const fullName =
    (typeof m.fullName === "string" && m.fullName.trim()) || "Sin nombre";
  const roleTitle = (typeof m.roleTitle === "string" && m.roleTitle.trim()) || "—";
  const phone = typeof m.phone === "string" ? m.phone.trim() : "";
  const email = typeof m.email === "string" ? m.email.trim() : "";
  const active = m.active !== false;
  const daysStr = formatDaysLabel(m.workDays);
  const hoursStr = formatTimeRange(m.hoursFrom, m.hoursTo);
  const href = telHref(phone);

  const card = document.createElement("article");
  card.className = "eq-member-card";
  card.dataset.memberId = m.id;

  const top = document.createElement("div");
  top.className = "eq-member-top";

  const av = document.createElement("div");
  av.className = "eq-member-avatar";
  av.textContent = initialsFromName(fullName);

  const headText = document.createElement("div");
  headText.className = "eq-member-head-text";

  const h = document.createElement("h3");
  h.className = "eq-member-name";
  h.textContent = fullName;

  const role = document.createElement("p");
  role.className = "eq-member-role";
  role.textContent = roleTitle;

  headText.append(h, role);

  const badge = document.createElement("span");
  badge.className = active ? "eq-status eq-status--on" : "eq-status eq-status--off";
  badge.textContent = active ? "Activo" : "Inactivo";

  top.append(av, headText, badge);

  const grid = document.createElement("div");
  grid.className = "eq-meta-grid";

  function row(label, valueEl) {
    const wrap = document.createElement("div");
    wrap.className = "eq-meta-row";
    const lb = document.createElement("span");
    lb.className = "eq-meta-label";
    lb.textContent = label;
    const val = document.createElement("div");
    val.className = "eq-meta-value";
    val.appendChild(valueEl);
    wrap.append(lb, val);
    return wrap;
  }

  const phoneContent = document.createElement("span");
  if (href) {
    const a = document.createElement("a");
    a.href = href;
    a.className = "eq-phone-link";
    a.textContent = phone || "—";
    phoneContent.appendChild(a);
  } else {
    phoneContent.textContent = phone || "—";
  }

  const emailContent = document.createElement("span");
  if (email) {
    const a = document.createElement("a");
    a.href = `mailto:${encodeURIComponent(email)}`;
    a.className = "eq-mail-link";
    a.textContent = email;
    emailContent.appendChild(a);
  } else {
    emailContent.textContent = "—";
  }

  grid.append(
    row("Teléfono", phoneContent),
    row("Correo", emailContent),
    row("Días asignados", document.createTextNode(daysStr)),
    row("Horario de trabajo", document.createTextNode(hoursStr)),
  );

  const actions = document.createElement("div");
  actions.className = "eq-member-actions";
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "eq-link-btn";
  editBtn.textContent = "Editar";
  editBtn.addEventListener("click", () => openModal(m.id));
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "eq-link-btn eq-link-btn--danger";
  delBtn.textContent = "Eliminar";
  delBtn.addEventListener("click", () => confirmDelete(m.id, fullName));
  actions.append(editBtn, delBtn);

  card.append(top, grid, actions);
  return card;
}

function renderList(list) {
  const root = document.getElementById("eq-members-root");
  if (!root) return;
  root.replaceChildren();

  if (!list.length) {
    renderEmpty(root);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "eq-members-grid";
  for (const m of list) {
    grid.appendChild(renderMemberCard(m));
  }
  root.appendChild(grid);
}

function updateStats(list) {
  const s = computeStats(list);
  setText("eq-stat-total", String(s.total));
  setText("eq-stat-active-today", String(s.activeToday));
  setText("eq-stat-operativo", String(s.operativo));
  setText("eq-stat-admin", String(s.admin));
  setPanelMeta(list.length);
}

function getVal(id) {
  const el = document.getElementById(id);
  return el && "value" in el ? String(el.value) : "";
}

function setVal(id, text) {
  const el = document.getElementById(id);
  if (el && "value" in el) el.value = text ?? "";
}

function getCheckedDays() {
  return Array.from(document.querySelectorAll('input[name="eq-day"]:checked')).map((el) => el.value);
}

function setCheckedDays(days) {
  const set = new Set(normalizeWorkDays(days));
  document.querySelectorAll('input[name="eq-day"]').forEach((el) => {
    if (el instanceof HTMLInputElement) {
      el.checked = set.has(el.value);
    }
  });
}

const modal = () => document.getElementById("eq-modal");

function openModal(memberId) {
  const host = modal();
  if (!host) return;
  const isEdit = typeof memberId === "string" && memberId.trim();
  const title = document.getElementById("eq-modal-title");
  const lead = document.getElementById("eq-modal-lead");
  if (title) title.textContent = isEdit ? "Editar miembro" : "Agregar miembro";
  if (lead) {
    lead.textContent = isEdit
      ? "Actualiza los datos operativos de esta persona."
      : "Datos operativos para organizar turnos y responsabilidades.";
  }

  const err = document.getElementById("eq-form-error");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }

  if (isEdit) {
    const m = members.find((x) => x.id === memberId);
    if (!m) return;
    setVal("eq-edit-id", m.id);
    setVal("eq-full-name", typeof m.fullName === "string" ? m.fullName : "");
    setVal("eq-role-title", typeof m.roleTitle === "string" ? m.roleTitle : "");
    setVal("eq-staff-category", normalizeCategory(m.staffCategory));
    setVal("eq-phone", typeof m.phone === "string" ? m.phone : "");
    setVal("eq-email", typeof m.email === "string" ? m.email : "");
    const activeEl = document.getElementById("eq-active");
    if (activeEl instanceof HTMLInputElement) activeEl.checked = m.active !== false;
    setCheckedDays(m.workDays);
    setVal("eq-hours-from", typeof m.hoursFrom === "string" ? m.hoursFrom : "");
    setVal("eq-hours-to", typeof m.hoursTo === "string" ? m.hoursTo : "");
  } else {
    setVal("eq-edit-id", "");
    setVal("eq-full-name", "");
    setVal("eq-role-title", "");
    setVal("eq-staff-category", "operativo");
    setVal("eq-phone", "");
    setVal("eq-email", "");
    const activeEl = document.getElementById("eq-active");
    if (activeEl instanceof HTMLInputElement) activeEl.checked = true;
    setCheckedDays([]);
    setVal("eq-hours-from", "");
    setVal("eq-hours-to", "");
  }

  host.hidden = false;
  host.setAttribute("aria-hidden", "false");
  document.body.classList.add("cf-modal-open");
  document.getElementById("eq-full-name")?.focus();
}

function closeModal() {
  const host = modal();
  if (!host) return;
  host.hidden = true;
  host.setAttribute("aria-hidden", "true");
  document.body.classList.remove("cf-modal-open");
}

function showFormError(msg) {
  const el = document.getElementById("eq-form-error");
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

async function confirmDelete(id, name) {
  const ok = window.confirm(
    `¿Eliminar a ${name} del equipo? Esta acción no se puede deshacer.`,
  );
  if (!ok || !businessId) return;
  try {
    await deleteDoc(doc(db, "businesses", businessId, "teamMembers", id));
    members = await fetchTeamMembersForBusiness(db, businessId);
    renderList(members);
    updateStats(members);
  } catch (e) {
    console.error(e);
    showLoadError("No se pudo eliminar. Revisa tu conexión e inténtalo otra vez.");
  }
}

async function submitForm(ev) {
  ev.preventDefault();
  if (!businessId) return;

  const fullName = getVal("eq-full-name").trim();
  const roleTitle = getVal("eq-role-title").trim();
  if (!fullName || !roleTitle) {
    showFormError("Nombre y cargo son obligatorios.");
    return;
  }
  showFormError("");

  const workDays = getCheckedDays();
  const payload = {
    fullName,
    roleTitle,
    staffCategory: getVal("eq-staff-category").trim() || "operativo",
    phone: getVal("eq-phone").trim(),
    email: getVal("eq-email").trim(),
    active: (() => {
      const el = document.getElementById("eq-active");
      return el instanceof HTMLInputElement ? el.checked : true;
    })(),
    workDays,
    hoursFrom: getVal("eq-hours-from").trim(),
    hoursTo: getVal("eq-hours-to").trim(),
    updatedAt: serverTimestamp(),
  };

  const editId = getVal("eq-edit-id").trim();

  try {
    if (editId) {
      await updateDoc(doc(db, "businesses", businessId, "teamMembers", editId), payload);
    } else {
      await addDoc(collection(db, "businesses", businessId, "teamMembers"), {
        ...payload,
        createdAt: serverTimestamp(),
      });
    }
    closeModal();
    members = await fetchTeamMembersForBusiness(db, businessId);
    renderList(members);
    updateStats(members);
  } catch (e) {
    console.error(e);
    showFormError("No se pudo guardar. Revisa tu conexión e inténtalo otra vez.");
  }
}

function wireModal() {
  document.getElementById("eq-open-add")?.addEventListener("click", () => openModal(null));
  document.getElementById("eq-modal-backdrop")?.addEventListener("click", closeModal);
  document.getElementById("eq-modal-cancel")?.addEventListener("click", closeModal);
  document.getElementById("eq-member-form")?.addEventListener("submit", submitForm);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal() && !modal()?.hidden) {
      closeModal();
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  initDashShell(auth);

  try {
    const business = await fetchBusinessForOwner(db, user.uid);
    if (!business) {
      showLoadError("No encontramos un negocio asociado a tu cuenta.");
      renderHeader(null);
      members = [];
      renderList(members);
      updateStats(members);
      return;
    }

    businessId = business.id;
    renderHeader(business);
    members = await fetchTeamMembersForBusiness(db, businessId);
    renderList(members);
    updateStats(members);
    showLoadError("");
  } catch (e) {
    console.error(e);
    showLoadError("No se pudo cargar el equipo. Revisa tu conexión e inténtalo otra vez.");
  }
});

wireModal();

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  addDoc,
  deleteDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  resolveBusinessForUser,
  fetchClientsForBusiness,
  formatBusinessMeta,
  initialsFromName,
} from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";
import { businessCollectionRef, businessDocRef } from "./category-context.js";

let allClients = [];
let cachedBusinessId = null;
let cachedUserId = null;
let jobsByClientId = new Map();

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

function setMetaLine(count) {
  const el = document.getElementById("cli-clients-meta");
  if (!el) return;
  if (count === 0) {
    el.textContent = "Tu base de clientes convertidos y de largo plazo.";
    return;
  }
  el.textContent = `${count} ${count === 1 ? "cliente" : "clientes"} · CRM de construcción`;
}

function showLoadError(msg) {
  const el = document.getElementById("cli-load-error");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function hideLoadError() {
  const el = document.getElementById("cli-load-error");
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
}

function renderEmpty(root) {
  root.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "cli-empty";
  wrap.innerHTML =
    '<div class="dash-leads-empty-icon" aria-hidden="true"></div>' +
    '<p class="dash-leads-empty-title">Aún no tienes clientes registrados.</p>' +
    '<p class="dash-leads-empty-text">Cuando conviertas solicitudes en clientes aparecerán aquí.</p>';
  root.appendChild(wrap);
}

function clientMatchesQuery(client, qRaw) {
  const q = qRaw.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    client.fullName,
    client.phone,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every((t) => hay.includes(t));
}

function filterClients(list, queryText) {
  const q = queryText.trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) => clientMatchesQuery(c, q));
}

function renderClientList(root, businessId, list) {
  root.replaceChildren();
  if (!list.length) {
    renderEmpty(root);
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "dash-table-wrap";
  const table = document.createElement("table");
  table.className = "dash-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Nombre</th>
        <th>Tipo</th>
        <th>Teléfono</th>
        <th>Email</th>
        <th>Dirección</th>
        <th>Trabajos enlazados</th>
        <th>Notas</th>
        <th>Acciones</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");
  for (const c of list) {
    const tr = document.createElement("tr");
    const fullName = (typeof c.fullName === "string" && c.fullName.trim()) || c.name || "Sin nombre";
    const phoneRaw = typeof c.phone === "string" ? c.phone.trim() : "—";
    const type = (typeof c.clientType === "string" && c.clientType.trim()) || "homeowner";
    const email = (typeof c.email === "string" && c.email.trim()) || "—";
    const address = (typeof c.address === "string" && c.address.trim()) || "—";
    const linkedJobs = Number(jobsByClientId.get(c.id) || 0);
    const notes = (typeof c.notes === "string" && c.notes.trim()) || "—";
    const clientId = typeof c.id === "string" ? c.id : "";
    tr.innerHTML = `
      <td><strong>${fullName}</strong></td>
      <td>${type}</td>
      <td>${phoneRaw}</td>
      <td>${email}</td>
      <td>${address}</td>
      <td>${linkedJobs}</td>
      <td>${notes}</td>
      <td>
        <button type="button" class="dash-icon-btn" data-client-edit="${clientId}" aria-label="Editar cliente">✏️</button>
        <button type="button" class="dash-icon-btn" data-client-delete="${clientId}" aria-label="Borrar cliente">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("[data-client-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-client-edit");
      const row = allClients.find((x) => x.id === id);
      if (!row) return;
      document.getElementById("cli-id").value = row.id || "";
      document.getElementById("cli-name").value = row.fullName || row.name || "";
      document.getElementById("cli-type").value = row.clientType || "homeowner";
      document.getElementById("cli-phone").value = row.phone || "";
      document.getElementById("cli-email").value = row.email || "";
      document.getElementById("cli-address").value = row.address || "";
      document.getElementById("cli-notes").value = row.notes || "";
      document.getElementById("cli-modal")?.showModal();
    });
  });
  tbody.querySelectorAll("[data-client-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-client-delete");
      if (!id || !cachedBusinessId) return;
      const ok = window.confirm("¿Seguro que quieres borrar este cliente?");
      if (!ok) return;
      btn.disabled = true;
      try {
        await deleteDoc(businessDocRef(db, cachedUserId, cachedBusinessId, "clients", id));
        allClients = allClients.filter((x) => x.id !== id);
        setMetaLine(allClients.length);
        if (cachedBusinessId) applySearch(cachedBusinessId);
      } catch (e) {
        window.alert("No se pudo borrar el cliente.");
      } finally {
        btn.disabled = false;
      }
    });
  });
  wrap.appendChild(table);
  root.appendChild(wrap);
}

async function saveClient(ev) {
  ev.preventDefault();
  if (!cachedBusinessId) return;
  const id = document.getElementById("cli-id").value.trim();
  const payload = {
    fullName: document.getElementById("cli-name").value.trim(),
    name: document.getElementById("cli-name").value.trim(),
    clientType: document.getElementById("cli-type").value,
    phone: document.getElementById("cli-phone").value.trim(),
    email: document.getElementById("cli-email").value.trim(),
    address: document.getElementById("cli-address").value.trim(),
    notes: document.getElementById("cli-notes").value.trim(),
    updatedAt: serverTimestamp(),
  };
  if (!id) {
    await addDoc(businessCollectionRef(db, cachedUserId, cachedBusinessId, "clients"), {
      ...payload,
      source: "manual",
      status: "active",
      createdAt: serverTimestamp(),
    });
  } else {
    await updateDoc(businessDocRef(db, cachedUserId, cachedBusinessId, "clients", id), payload);
  }
  document.getElementById("cli-modal")?.close();
  const fresh = await fetchClientsForBusiness(db, cachedBusinessId, cachedUserId);
  allClients = fresh;
  setMetaLine(allClients.length);
  applySearch(cachedBusinessId);
}

function applySearch(businessId) {
  const input = document.getElementById("cli-search");
  const root = document.getElementById("cli-clients-root");
  if (!root) return;
  const q = input ? input.value : "";
  const filtered = filterClients(allClients, q);
  if (!filtered.length && allClients.length > 0) {
    root.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "cli-no-results";
    empty.textContent = "Ningún cliente coincide con la búsqueda.";
    root.appendChild(empty);
    return;
  }
  renderClientList(root, businessId, filtered);
}

async function loadClientesForUser(user) {
  hideLoadError();
  const business = await resolveBusinessForUser(db, user);
  renderHeader(business);

  const root = document.getElementById("cli-clients-root");
  const search = document.getElementById("cli-search");
  if (!root) return;

  if (!business) {
    cachedBusinessId = null;
    cachedUserId = null;
    allClients = [];
    setMetaLine(0);
    renderEmpty(root);
    return;
  }

  cachedBusinessId = business.id;
  cachedUserId = business?.scope?.uid || user.uid;
  try {
    const jobsSnap = await getDocs(businessCollectionRef(db, cachedUserId, business.id, "jobs"));
    const map = new Map();
    jobsSnap.forEach((d) => {
      const row = d.data() || {};
      const cid = typeof row.clientId === "string" ? row.clientId : "";
      if (!cid) return;
      map.set(cid, Number(map.get(cid) || 0) + 1);
    });
    jobsByClientId = map;
  } catch {
    jobsByClientId = new Map();
  }

  let clients;
  try {
    clients = await fetchClientsForBusiness(db, business.id, cachedUserId);
  } catch (err) {
    console.error(err);
    cachedBusinessId = null;
    showLoadError("No se pudieron cargar los clientes. Inténtalo de nuevo.");
    setMetaLine(0);
    root.replaceChildren();
    return;
  }

  allClients = clients;
  setMetaLine(clients.length);
  if (search) search.value = "";
  applySearch(business.id);
}

function boot() {
  initDashShell({ auth, db });

  document.getElementById("cli-search")?.addEventListener("input", () => {
    if (cachedBusinessId) applySearch(cachedBusinessId);
  });
  document.getElementById("cli-btn-new")?.addEventListener("click", () => {
    document.getElementById("cli-form")?.reset();
    document.getElementById("cli-id").value = "";
    document.getElementById("cli-modal")?.showModal();
  });
  document.getElementById("cli-btn-cancel")?.addEventListener("click", () => {
    document.getElementById("cli-modal")?.close();
  });
  document.getElementById("cli-form")?.addEventListener("submit", (ev) => {
    saveClient(ev).catch((e) => {
      console.error(e);
      window.alert("No se pudo guardar el cliente.");
    });
  });

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }

    loadClientesForUser(user).catch((err) => {
      console.error(err);
      renderHeader(null);
      showLoadError("Error al cargar el módulo de clientes.");
      const root = document.getElementById("cli-clients-root");
      if (root) renderEmpty(root);
      setMetaLine(0);
      cachedBusinessId = null;
    });
  });
}

boot();

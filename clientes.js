import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  resolveBusinessForUser,
  fetchClientsForBusiness,
  formatBusinessMeta,
  formatShortDate,
  initialsFromName,
} from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";

let allClients = [];
let cachedBusinessId = null;

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
  el.textContent = `${count} ${count === 1 ? "cliente" : "clientes"} · más recientes primero`;
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
        <th>Teléfono</th>
        <th>Último pedido</th>
        <th>Último contacto</th>
        <th>Total pedidos</th>
        <th>Estado</th>
        <th>Fuente</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");
  for (const c of list) {
    const tr = document.createElement("tr");
    const fullName = (typeof c.fullName === "string" && c.fullName.trim()) || c.name || "Sin nombre";
    const phoneRaw = typeof c.phone === "string" ? c.phone.trim() : "—";
    const lastOrderAt = c.lastOrderAt ? formatShortDate(c.lastOrderAt) : "—";
    const lastContactAt = c.lastContactAt ? formatShortDate(c.lastContactAt) : "—";
    const totalOrders = Number(c.totalOrders || 0) || 0;
    const status = (typeof c.status === "string" && c.status.trim()) || "activo";
    const source = (typeof c.source === "string" && c.source.trim()) || "manual";
    tr.innerHTML = `
      <td><strong>${fullName}</strong></td>
      <td>${phoneRaw}</td>
      <td>${lastOrderAt}</td>
      <td>${lastContactAt}</td>
      <td>${totalOrders}</td>
      <td>${status}</td>
      <td>${source}</td>
    `;
    tbody.appendChild(tr);
  }
  wrap.appendChild(table);
  root.appendChild(wrap);
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
    allClients = [];
    setMetaLine(0);
    renderEmpty(root);
    return;
  }

  cachedBusinessId = business.id;

  let clients;
  try {
    clients = await fetchClientsForBusiness(db, business.id);
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

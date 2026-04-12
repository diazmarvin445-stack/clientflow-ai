import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  doc,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  fetchBusinessForOwner,
  fetchClientsForBusiness,
  formatBusinessMeta,
  formatLeadRelativeTimeEs,
  formatShortDate,
  initialsFromName,
  SERVICE_LABELS,
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

function serviceLabel(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "—";
  return SERVICE_LABELS[s] || s;
}

function formatMoney(raw) {
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) return null;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function telHref(phone) {
  const s = typeof phone === "string" ? phone.trim() : "";
  if (!s) return null;
  const cleaned = s.replace(/[^\d+]/g, "");
  return cleaned ? `tel:${cleaned}` : null;
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
    client.address,
    client.primaryService,
    serviceLabel(client.primaryService),
    client.notes,
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
  list.forEach((c) => {
    root.appendChild(buildClientCard(businessId, c));
  });
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

function metaRow(label, valueNode) {
  const row = document.createElement("div");
  row.className = "cli-meta-row";
  const lab = document.createElement("span");
  lab.className = "cli-meta-label";
  lab.textContent = label;
  const val = document.createElement("div");
  val.className = "cli-meta-value";
  val.appendChild(valueNode);
  row.append(lab, val);
  return row;
}

function textNode(text) {
  const s = document.createElement("span");
  s.textContent = text;
  return s;
}

function buildClientCard(businessId, client) {
  const id = client.id;
  const fullName =
    (typeof client.fullName === "string" && client.fullName.trim()) || "Sin nombre";
  const phoneRaw = typeof client.phone === "string" ? client.phone.trim() : "";
  const address = (typeof client.address === "string" && client.address.trim()) || "—";
  const relCreated = formatLeadRelativeTimeEs(client.createdAt);
  const absCreated = formatShortDate(client.createdAt);
  const lastRaw = client.lastServiceDate;
  const hasLast = lastRaw != null;
  const relLast = hasLast ? formatLeadRelativeTimeEs(lastRaw) : "";
  const absLast = hasLast ? formatShortDate(lastRaw) : "";
  const totalLine = formatMoney(client.totalValue);
  const notesVal = client.notes != null ? String(client.notes) : "";

  const article = document.createElement("article");
  article.className = "cli-client-card";
  article.dataset.clientId = id;

  const top = document.createElement("div");
  top.className = "cli-client-top";

  const avatar = document.createElement("div");
  avatar.className = "cli-client-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = initialsFromName(fullName);

  const headText = document.createElement("div");
  headText.className = "cli-client-head-text";

  const h3 = document.createElement("h3");
  h3.className = "cli-client-name";
  h3.textContent = fullName;

  const timeLine = document.createElement("p");
  timeLine.className = "cli-client-time";
  timeLine.textContent = `Alta · ${relCreated} · ${absCreated}`;

  headText.append(h3, timeLine);
  top.append(avatar, headText);

  const grid = document.createElement("div");
  grid.className = "cli-meta-grid";

  const phoneNode = document.createElement("span");
  if (phoneRaw) {
    const tel = telHref(phoneRaw);
    if (tel) {
      const a = document.createElement("a");
      a.href = tel;
      a.className = "cli-phone-link";
      a.textContent = phoneRaw;
      phoneNode.appendChild(a);
    } else {
      phoneNode.textContent = phoneRaw;
    }
  } else {
    phoneNode.textContent = "—";
  }
  grid.appendChild(metaRow("Teléfono", phoneNode));
  grid.appendChild(metaRow("Dirección", textNode(address)));
  grid.appendChild(metaRow("Servicio principal", textNode(serviceLabel(client.primaryService))));

  if (hasLast) {
    const lastWrap = document.createElement("span");
    lastWrap.textContent = `${relLast} · ${absLast}`;
    grid.appendChild(metaRow("Último servicio", lastWrap));
  }

  if (totalLine) {
    grid.appendChild(metaRow("Valor acumulado", textNode(totalLine)));
  }

  article.append(top, grid);

  if (typeof client.sourceLeadId === "string" && client.sourceLeadId.trim()) {
    const src = document.createElement("p");
    src.className = "cli-source-hint";
    src.textContent = "Origen: solicitud convertida";
    article.appendChild(src);
  }

  const details = document.createElement("details");
  details.className = "cli-notes";
  if (notesVal.trim().length > 0) details.open = true;

  const summ = document.createElement("summary");
  summ.className = "cli-notes-summary";
  summ.textContent = "Notas";

  const notesBody = document.createElement("div");
  notesBody.className = "cli-notes-body";

  const ta = document.createElement("textarea");
  ta.className = "cli-notes-input";
  ta.rows = 4;
  ta.maxLength = 8000;
  ta.value = notesVal;
  ta.setAttribute("aria-label", `Notas de ${fullName}`);
  ta.placeholder = "Historial de servicios, preferencias, recordatorios…";

  const foot = document.createElement("div");
  foot.className = "cli-notes-foot";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "cli-notes-save dash-quick-btn dash-quick-btn--primary";
  saveBtn.textContent = "Guardar notas";

  const hint = document.createElement("span");
  hint.className = "cli-inline-hint";
  hint.setAttribute("aria-live", "polite");
  hint.hidden = true;

  foot.append(saveBtn, hint);
  notesBody.append(ta, foot);
  details.append(summ, notesBody);
  article.appendChild(details);

  saveBtn.addEventListener("click", async () => {
    const text = ta.value;
    saveBtn.disabled = true;
    saveBtn.setAttribute("aria-busy", "true");
    hint.hidden = true;
    try {
      await updateDoc(doc(db, "businesses", businessId, "clients", id), {
        notes: text,
        updatedAt: serverTimestamp(),
      });
      hint.textContent = "Notas guardadas";
      hint.className = "cli-inline-hint cli-inline-hint--ok";
      hint.hidden = false;
      window.setTimeout(() => {
        hint.hidden = true;
      }, 2500);
    } catch (err) {
      console.error(err);
      hint.textContent = "No se pudieron guardar las notas.";
      hint.className = "cli-inline-hint cli-inline-hint--bad";
      hint.hidden = false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.removeAttribute("aria-busy");
    }
  });

  return article;
}

async function loadClientesForUser(user) {
  hideLoadError();
  const business = await fetchBusinessForOwner(db, user.uid);
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
  initDashShell({ auth });

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

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  buildClientPayloadFromLead,
  resolveBusinessForUser,
  fetchLeadsForBusiness,
  formatBusinessMeta,
  formatLeadRelativeTimeEs,
  formatShortDate,
  initialsFromName,
  LEAD_STATUS_OPTIONS_ES,
  normalizeLeadStatus,
  SERVICE_LABELS,
} from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";

function getPublicRequestUrl(businessId) {
  const id = typeof businessId === "string" ? businessId.trim() : "";
  if (!id) return "";
  const rel = `solicitar.html?businessId=${encodeURIComponent(id)}`;
  return new URL(rel, window.location.href).href;
}

function syncRequestLinkSection(business) {
  const section = document.getElementById("sol-request-link-section");
  const urlEl = document.getElementById("sol-request-link-url");
  const openA = document.getElementById("sol-open-form");
  const feedback = document.getElementById("sol-copy-feedback");
  if (!section || !urlEl || !openA) return;

  if (!business || typeof business.id !== "string" || !business.id.trim()) {
    section.hidden = true;
    urlEl.textContent = "";
    openA.href = "solicitar.html";
    if (feedback) feedback.hidden = true;
    return;
  }

  const url = getPublicRequestUrl(business.id);
  urlEl.textContent = url;
  openA.href = url;
  section.hidden = false;
  if (feedback) {
    feedback.hidden = true;
    feedback.textContent = "";
  }
}

let requestLinkUiWired = false;
function ensureRequestLinkUiWired() {
  if (requestLinkUiWired) return;
  requestLinkUiWired = true;
  const copyBtn = document.getElementById("sol-copy-link");
  const feedback = document.getElementById("sol-copy-feedback");
  copyBtn?.addEventListener("click", async () => {
    const urlEl = document.getElementById("sol-request-link-url");
    const text = urlEl && urlEl.textContent ? urlEl.textContent.trim() : "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (feedback) {
        feedback.textContent = "Enlace copiado al portapapeles";
        feedback.hidden = false;
        window.setTimeout(() => {
          if (feedback) feedback.hidden = true;
        }, 2800);
      }
    } catch (err) {
      console.error(err);
      if (feedback) {
        feedback.textContent = "No se pudo copiar automáticamente. Selecciona el enlace y cópialo manualmente.";
        feedback.hidden = false;
        feedback.style.color = "#b45309";
        window.setTimeout(() => {
          if (feedback) {
            feedback.hidden = true;
            feedback.style.color = "";
          }
        }, 4000);
      }
    }
  });
}

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

function formatPriceLine(raw) {
  const v = Number(raw);
  if (Number.isFinite(v) && v > 0) {
    return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return null;
}

function telHref(phone) {
  const s = typeof phone === "string" ? phone.trim() : "";
  if (!s) return null;
  const cleaned = s.replace(/[^\d+]/g, "");
  return cleaned ? `tel:${cleaned}` : null;
}

function setMetaLine(count) {
  const el = document.getElementById("sol-leads-meta");
  if (!el) return;
  if (count === 0) {
    el.textContent = "Gestiona el estado y las notas de cada lead.";
    return;
  }
  el.textContent = `${count} ${count === 1 ? "solicitud" : "solicitudes"} · más recientes primero`;
}

function showLoadError(msg) {
  const el = document.getElementById("sol-load-error");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function hideLoadError() {
  const el = document.getElementById("sol-load-error");
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
}

function renderEmpty(root) {
  root.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "sol-empty";
  wrap.innerHTML =
    '<div class="dash-leads-empty-icon" aria-hidden="true"></div>' +
    '<p class="dash-leads-empty-title">Aún no tienes solicitudes.</p>' +
    '<p class="dash-leads-empty-text">Cuando entren nuevos clientes potenciales aparecerán aquí.</p>';
  root.appendChild(wrap);
}

function metaRow(label, valueNode) {
  const row = document.createElement("div");
  row.className = "sol-meta-row";
  const lab = document.createElement("span");
  lab.className = "sol-meta-label";
  lab.textContent = label;
  const val = document.createElement("div");
  val.className = "sol-meta-value";
  val.appendChild(valueNode);
  row.append(lab, val);
  return row;
}

function textNode(text) {
  const s = document.createElement("span");
  s.textContent = text;
  return s;
}

function refreshConvertUI(article, businessId, leadRef) {
  const old = article.querySelector(".sol-convert");
  if (old) old.remove();
  const el = buildConvertSection(article, businessId, leadRef);
  const notes = article.querySelector(".sol-notes");
  if (el && notes) article.insertBefore(el, notes);
  else if (el) article.appendChild(el);
}

/**
 * Idempotent: creates one client per lead and marks the lead. Safe to call multiple times.
 * @returns {"skipped" | "created" | "error"}
 */
async function convertLeadToClientRecord(businessId, leadRef) {
  if (leadRef.convertedToClient === true) return "skipped";
  const existingId =
    typeof leadRef.convertedToClientId === "string" ? leadRef.convertedToClientId.trim() : "";
  if (existingId) return "skipped";

  try {
    const payload = buildClientPayloadFromLead(leadRef);
    const toWrite = { ...payload };
    if (toWrite.createdAt == null) {
      toWrite.createdAt = serverTimestamp();
    }
    const ref = await addDoc(collection(db, "businesses", businessId, "clients"), toWrite);
    await updateDoc(doc(db, "businesses", businessId, "leads", leadRef.id), {
      convertedToClient: true,
      convertedClientId: ref.id,
      updatedAt: serverTimestamp(),
    });
    leadRef.convertedToClient = true;
    leadRef.convertedToClientId = ref.id;
    return "created";
  } catch (err) {
    console.error("[ClientFlow] Error al convertir solicitud en cliente:", err);
    console.error("[ClientFlow] Detalle (leadId):", leadRef.id);
    return "error";
  }
}

function buildConvertSection(article, businessId, leadRef) {
  const convertedId =
    typeof leadRef.convertedToClientId === "string"
      ? leadRef.convertedToClientId.trim()
      : "";
  if (leadRef.convertedToClient === true || convertedId) {
    const wrap = document.createElement("div");
    wrap.className = "sol-convert sol-convert--done";
    const a = document.createElement("a");
    a.href = "clientes.html";
    a.className = "sol-convert-link";
    a.textContent = "Ver en Clientes";
    wrap.appendChild(a);
    return wrap;
  }

  const st = normalizeLeadStatus(leadRef.status);
  if (st !== "completed") return null;

  const wrap = document.createElement("div");
  wrap.className = "sol-convert";
  const hint = document.createElement("p");
  hint.className = "sol-convert-hint";
  hint.textContent =
    "Si la conversión automática falló, puedes crear el cliente manualmente con los mismos datos.";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sol-convert-btn dash-quick-btn dash-quick-btn--primary";
  btn.textContent = "Convertir en cliente";

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const result = await convertLeadToClientRecord(businessId, leadRef);
      if (result === "error") {
        window.alert(
          "No se pudo crear el cliente. Revisa la conexión y que las reglas de Firestore permitan escribir en clientes.",
        );
      } else {
        refreshConvertUI(article, businessId, leadRef);
      }
    } finally {
      btn.disabled = false;
    }
  });

  wrap.append(hint, btn);
  return wrap;
}

function buildLeadCard(businessId, lead) {
  const leadBusinessId =
    typeof lead._cfBusinessId === "string" && lead._cfBusinessId.trim()
      ? lead._cfBusinessId.trim()
      : businessId;
  const id = lead.id;
  const leadRef = { ...lead, id };
  const name =
    (typeof lead.customerName === "string" && lead.customerName.trim()) ||
    (typeof lead.clientName === "string" && lead.clientName.trim()) ||
    (typeof lead.name === "string" && lead.name.trim()) ||
    "Sin nombre";

  const phoneRaw = typeof lead.phone === "string" ? lead.phone.trim() : "";
  const address =
    (typeof lead.address === "string" && lead.address.trim()) || "—";
  const canonical = normalizeLeadStatus(lead.status);
  const rel = formatLeadRelativeTimeEs(lead.createdAt);
  const abs = formatShortDate(lead.createdAt);
  const priceLine = formatPriceLine(lead.estimatedPrice);
  const desc =
    typeof lead.description === "string" && lead.description.trim()
      ? lead.description.trim()
      : "";

  const notesVal = lead.notes != null ? String(lead.notes) : "";

  const article = document.createElement("article");
  article.className = "sol-lead-card";
  article.dataset.leadId = id;

  const head = document.createElement("div");
  head.className = "sol-lead-card-head";

  const titleRow = document.createElement("div");
  titleRow.className = "sol-lead-title-row";

  const h3 = document.createElement("h3");
  h3.className = "sol-lead-name";
  h3.textContent = name;

  titleRow.appendChild(h3);

  if (canonical === "new") {
    const pri = document.createElement("span");
    pri.className = "sol-priority-badge";
    pri.textContent = "Nuevo";
    pri.title = "Lead sin gestionar";
    titleRow.appendChild(pri);
  }

  head.appendChild(titleRow);

  const timeEl = document.createElement("p");
  timeEl.className = "sol-lead-time";
  timeEl.textContent = `${rel} · ${abs}`;

  head.appendChild(timeEl);

  const grid = document.createElement("div");
  grid.className = "sol-meta-grid";

  const phoneNode = document.createElement("span");
  if (phoneRaw) {
    const tel = telHref(phoneRaw);
    if (tel) {
      const a = document.createElement("a");
      a.href = tel;
      a.className = "sol-phone-link";
      a.textContent = phoneRaw;
      phoneNode.appendChild(a);
    } else {
      phoneNode.textContent = phoneRaw;
    }
  } else {
    phoneNode.textContent = "—";
  }
  grid.appendChild(metaRow("Teléfono", phoneNode));

  grid.appendChild(metaRow("Servicio", textNode(serviceLabel(lead.service))));

  const addrSpan = document.createElement("span");
  addrSpan.textContent = address;
  grid.appendChild(metaRow("Dirección", addrSpan));

  grid.appendChild(
    metaRow(
      "Presupuesto estimado",
      textNode(priceLine != null ? priceLine : "—"),
    ),
  );

  const statusWrap = document.createElement("div");
  statusWrap.className = "sol-status-field";

  const statusLab = document.createElement("label");
  const statusId = `sol-status-${id}`;
  statusLab.setAttribute("for", statusId);
  statusLab.className = "sol-status-label";
  statusLab.textContent = "Estado";

  const select = document.createElement("select");
  select.id = statusId;
  select.className = "sol-status-select";
  select.setAttribute("aria-label", `Estado de la solicitud de ${name}`);

  LEAD_STATUS_OPTIONS_ES.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    select.appendChild(o);
  });

  select.value = canonical;
  select.dataset.lastSaved = canonical;

  statusWrap.append(statusLab, select);
  grid.appendChild(statusWrap);

  article.append(head, grid);

  if (desc) {
    const descBlock = document.createElement("div");
    descBlock.className = "sol-lead-desc";
    const dLab = document.createElement("span");
    dLab.className = "sol-meta-label";
    dLab.textContent = "Descripción";
    const dBody = document.createElement("p");
    dBody.className = "sol-lead-desc-text";
    dBody.textContent = desc;
    descBlock.append(dLab, dBody);
    article.appendChild(descBlock);
  }

  const convertEl = buildConvertSection(article, leadBusinessId, leadRef);
  if (convertEl) article.appendChild(convertEl);

  const details = document.createElement("details");
  details.className = "sol-notes";
  if (notesVal.trim().length > 0) details.open = true;

  const summ = document.createElement("summary");
  summ.className = "sol-notes-summary";
  summ.textContent = "Notas internas";

  const notesBody = document.createElement("div");
  notesBody.className = "sol-notes-body";

  const ta = document.createElement("textarea");
  ta.className = "sol-notes-input";
  ta.rows = 4;
  ta.maxLength = 8000;
  ta.value = notesVal;
  ta.setAttribute("aria-label", `Notas para ${name}`);
  ta.placeholder = "Seguimiento de llamadas, acuerdos, recordatorios…";

  const foot = document.createElement("div");
  foot.className = "sol-notes-foot";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "sol-notes-save dash-quick-btn dash-quick-btn--primary";
  saveBtn.textContent = "Guardar notas";

  const statusHint = document.createElement("span");
  statusHint.className = "sol-inline-hint";
  statusHint.setAttribute("aria-live", "polite");
  statusHint.hidden = true;

  foot.append(saveBtn, statusHint);
  notesBody.append(ta, foot);
  details.append(summ, notesBody);
  article.appendChild(details);

  select.addEventListener("change", async () => {
    const next = select.value;
    const prev = select.dataset.lastSaved || canonical;
    article.classList.add("sol-lead-card--busy");
    select.disabled = true;
    statusHint.hidden = true;
    try {
      await updateDoc(doc(db, "businesses", leadBusinessId, "leads", id), {
        status: next,
        updatedAt: serverTimestamp(),
      });
      select.dataset.lastSaved = next;
      leadRef.status = next;

      const norm = normalizeLeadStatus(next);
      if (norm === "completed") {
        const conv = await convertLeadToClientRecord(leadBusinessId, leadRef);
        if (conv === "error") {
          console.error(
            "[ClientFlow] Estado guardado como Ganado, pero la creación automática del cliente falló. Lead:",
            id,
          );
        }
      }

      refreshConvertUI(article, leadBusinessId, leadRef);
    } catch (err) {
      console.error(err);
      select.value = prev;
      statusHint.textContent = "No se pudo guardar el estado. Revisa la conexión o las reglas.";
      statusHint.className = "sol-inline-hint sol-inline-hint--bad";
      statusHint.hidden = false;
    } finally {
      select.disabled = false;
      article.classList.remove("sol-lead-card--busy");
    }
  });

  saveBtn.addEventListener("click", async () => {
    const text = ta.value;
    saveBtn.disabled = true;
    saveBtn.setAttribute("aria-busy", "true");
    statusHint.hidden = true;
    try {
      await updateDoc(doc(db, "businesses", leadBusinessId, "leads", id), {
        notes: text,
        updatedAt: serverTimestamp(),
      });
      statusHint.textContent = "Notas guardadas";
      statusHint.className = "sol-inline-hint sol-inline-hint--ok";
      statusHint.hidden = false;
      window.setTimeout(() => {
        statusHint.hidden = true;
      }, 2500);
    } catch (err) {
      console.error(err);
      statusHint.textContent = "No se pudieron guardar las notas.";
      statusHint.className = "sol-inline-hint sol-inline-hint--bad";
      statusHint.hidden = false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.removeAttribute("aria-busy");
    }
  });

  return article;
}

function renderLeadList(root, businessId, leads) {
  root.replaceChildren();
  if (!leads.length) {
    renderEmpty(root);
    return;
  }
  leads.forEach((lead) => {
    root.appendChild(buildLeadCard(businessId, lead));
  });
}

async function loadSolicitudesForUser(user) {
  hideLoadError();
  ensureRequestLinkUiWired();
  const business = await resolveBusinessForUser(db, user);
  renderHeader(business);
  syncRequestLinkSection(business);

  const root = document.getElementById("sol-leads-root");
  if (!root) return;

  if (!business) {
    setMetaLine(0);
    renderEmpty(root);
    return;
  }

  let leads;
  try {
    console.log(
      "[ClientFlow solicitudes] Reading leads for owner; primary businessId=",
      business.id,
      "uid=",
      user.uid,
    );
    leads = await fetchLeadsForBusiness(db, business.id, user.uid);
  } catch (err) {
    console.error(err);
    showLoadError("No se pudieron cargar las solicitudes. Inténtalo de nuevo.");
    setMetaLine(0);
    root.replaceChildren();
    return;
  }

  setMetaLine(leads.length);
  renderLeadList(root, business.id, leads);
}

function boot() {
  initDashShell({ auth, db });

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    loadSolicitudesForUser(user).catch((err) => {
      console.error(err);
      renderHeader(null);
      syncRequestLinkSection(null);
      showLoadError("Error al cargar el módulo de solicitudes.");
      const root = document.getElementById("sol-leads-root");
      if (root) renderEmpty(root);
      setMetaLine(0);
    });
  });
}

boot();

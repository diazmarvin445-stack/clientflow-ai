import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  collection,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { resolveBusinessForUser, formatBusinessMeta, initialsFromName } from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";
import {
  mapDiagnosticFriendlyMessage,
  setDiagnosticsLoggerContext,
  wireGlobalDiagnosticsListeners,
} from "./diagnostics-logger.js";
import { businessCollectionRef, businessDocRef } from "./category-context.js";
import { profileDocRef } from "./dataPaths.js";

const STATUS_OK = "ok";
const STATUS_WARNING = "warning";
const STATUS_ERROR = "error";

function renderHeader(business) {
  const nameEl = document.getElementById("dash-business-name");
  const metaEl = document.getElementById("dash-business-meta");
  const av = document.getElementById("dash-avatar-initials");
  if (!business) return;
  const data = business.data || {};
  const displayName = (typeof data.businessName === "string" && data.businessName.trim()) || "Tu negocio";
  const meta = formatBusinessMeta(data);
  if (nameEl) nameEl.textContent = displayName;
  if (metaEl) metaEl.textContent = meta.metaLine;
  if (av) av.textContent = initialsFromName(displayName);
}

function showError(message) {
  const el = document.getElementById("diag-error");
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || "";
}

function badgeLabel(status) {
  if (status === STATUS_OK) return "OK";
  if (status === STATUS_WARNING) return "Warning";
  return "Error";
}

function formatNow() {
  return new Date().toLocaleString("es");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderPanel(targetId, result) {
  const el = document.getElementById(targetId);
  if (!el) return;
  const details = Array.isArray(result?.details) ? result.details : [];
  const detailsHtml = details.length
    ? `<ul class="diag-check-list">${details.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<p class="diag-muted">Sin detalles.</p>`;
  el.innerHTML = `
    <div class="diag-status-row">
      <span class="diag-status-badge diag-status-badge--${result.status}">${badgeLabel(result.status)}</span>
      <span class="diag-item-meta">Último resultado: ${escapeHtml(result.checkedAt || formatNow())}</span>
    </div>
    <p class="diag-item-title">${escapeHtml(result.explanation || "Sin explicación")}</p>
    ${detailsHtml}
  `;
}

function getIncidentSummary(rows, moduleHints) {
  const filtered = rows.filter((row) =>
    moduleHints.some((hint) => String(row.module || "").toLowerCase().includes(hint)),
  );
  if (!filtered.length) {
    return { count: 0, top: null };
  }
  const top = filtered[0];
  return {
    count: filtered.length,
    top,
  };
}

async function checkChatMayaHealth(businessId, incidentInfo) {
  const details = [];
  let status = STATUS_OK;
  let explanation = "Maya tiene estructura base disponible.";
  try {
    const [chatHtmlRes, stylesRes, chatJsRes] = await Promise.all([fetch("chat.html"), fetch("styles.css"), fetch("chat.js")]);
    const chatHtml = chatHtmlRes.ok ? await chatHtmlRes.text() : "";
    const stylesCss = stylesRes.ok ? await stylesRes.text() : "";
    const chatJs = chatJsRes.ok ? await chatJsRes.text() : "";
    const hasMessagesContainer =
      /id=["']yc-maya-messages-v2["']/.test(chatHtml) || /yc-maya-messages-isolated/.test(chatJs);
    const hasInput = /id=["']yc-chat-input["']/.test(chatHtml) || /id="yc-chat-input"/.test(chatJs);
    const hasScrollableRule =
      /\.yc-maya-messages-v2[\s\S]*overflow-y:\s*(auto|scroll)/i.test(stylesCss);
    const hasIsolatedLayer = /yourcolor-maya-chat-isolated/.test(chatJs);
    details.push(`Contenedor de mensajes detectado: ${hasMessagesContainer ? "sí" : "no"}`);
    details.push(`Input de Maya detectado: ${hasInput ? "sí" : "no"}`);
    details.push(`Regla de scroll detectada en CSS: ${hasScrollableRule ? "sí" : "no"}`);
    details.push(`Capa aislada detectada en chat.js: ${hasIsolatedLayer ? "sí" : "no"}`);
    if (!hasMessagesContainer || !hasInput || !hasScrollableRule || !hasIsolatedLayer) {
      status = STATUS_ERROR;
      explanation = "Faltan elementos o reglas clave para el chat Maya.";
    }

    const runtimeProbe = await runMayaRuntimeUiProbe();
    details.push(...runtimeProbe.details);
    if (runtimeProbe.status === STATUS_ERROR) {
      status = STATUS_ERROR;
      explanation = runtimeProbe.explanation;
    } else if (runtimeProbe.status === STATUS_WARNING && status !== STATUS_ERROR) {
      status = STATUS_WARNING;
      explanation = runtimeProbe.explanation;
    }
  } catch (error) {
    status = STATUS_ERROR;
    explanation = "No se pudo validar la estructura de Chat Maya.";
    details.push(`Error técnico: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (incidentInfo.count > 0 && status === STATUS_OK) {
    status = STATUS_WARNING;
    explanation = "La estructura de Maya está disponible, pero hay incidentes recientes.";
    details.push(`Incidentes recientes en Maya/chat: ${incidentInfo.count}`);
  }
  details.push(`businessId detectado: ${businessId ? "sí" : "no"}`);
  return { status, explanation, details, checkedAt: formatNow() };
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function withTimeout(promise, ms = 12000) {
  return new Promise((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error("Timeout en prueba de Maya UI")), ms);
    promise
      .then((value) => {
        window.clearTimeout(id);
        resolve(value);
      })
      .catch((err) => {
        window.clearTimeout(id);
        reject(err);
      });
  });
}

function readOverflow(el) {
  const cs = window.getComputedStyle(el);
  return {
    x: cs.overflowX || "",
    y: cs.overflowY || "",
  };
}

async function runMayaRuntimeUiProbe() {
  const details = [];
  let status = STATUS_OK;
  let explanation = "Chat Maya usable en pruebas de UI.";

  /** @type {HTMLIFrameElement | null} */
  let iframe = null;
  try {
    iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    iframe.style.position = "fixed";
    iframe.style.left = "-20000px";
    iframe.style.top = "0";
    iframe.style.width = "390px";
    iframe.style.height = "780px";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    document.body.appendChild(iframe);

    await withTimeout(
      new Promise((resolve, reject) => {
        iframe.addEventListener("load", resolve, { once: true });
        iframe.addEventListener("error", () => reject(new Error("No se pudo cargar chat.html en iframe")), {
          once: true,
        });
        iframe.src = "chat.html";
      }),
      15000,
    );

    await wait(1500);
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      return {
        status: STATUS_ERROR,
        explanation: "No se pudo acceder al documento de Chat Maya para pruebas de UI.",
        details: ["iframe sin contentDocument/contentWindow"],
      };
    }

    const messages = doc.querySelector("#yc-maya-messages-isolated, #yc-maya-messages-v2, .yc-maya-messages-v2");
    const input = doc.querySelector("#yc-chat-input, #yc-maya-input-v2, .yc-maya-input-v2");
    const possibleStreams = doc.querySelectorAll("#yc-maya-messages-isolated, #yc-maya-messages-v2, .yc-maya-messages-v2");

    if (!messages || !input) {
      return {
        status: STATUS_ERROR,
        explanation: "Chat Maya no renderiza contenedor de mensajes o input en runtime.",
        details: [
          `messages encontrado: ${messages ? "sí" : "no"}`,
          `input encontrado: ${input ? "sí" : "no"}`,
        ],
      };
    }

    details.push(`Contenedores de mensajes detectados: ${possibleStreams.length}`);
    if (possibleStreams.length > 1) {
      status = STATUS_WARNING;
      explanation = "Múltiples contenedores de mensajes pueden interferir con el layout.";
      details.push("WARNING: Multiple containers interfering with layout");
    }

    const msgEl = /** @type {HTMLElement} */ (messages);
    const inputEl = /** @type {HTMLElement} */ (input);

    const beforeTop = msgEl.scrollTop;
    const beforeHeight = msgEl.scrollHeight;
    const beforeClient = msgEl.clientHeight;
    msgEl.scrollTop = beforeTop + 120;
    await wait(120);
    const afterTop = msgEl.scrollTop;
    const scrollHeightGt = beforeHeight > beforeClient;
    const scrollMoved = afterTop !== beforeTop;
    details.push(`scrollHeight/clientHeight: ${beforeHeight}/${beforeClient}`);
    details.push(`scrollHeight > clientHeight: ${scrollHeightGt ? "sí" : "no"}`);
    details.push(`scrollTop cambió tras prueba programática: ${scrollMoved ? "sí" : "no"}`);

    if (scrollHeightGt && !scrollMoved) {
      return {
        status: STATUS_ERROR,
        explanation: "Chat not scrollable",
        details: [...details, "ERROR: Chat not scrollable"],
      };
    }

    if (!scrollHeightGt) {
      if (status !== STATUS_ERROR) {
        status = STATUS_WARNING;
        explanation = "No hay suficiente overflow para validar scroll completo en este momento.";
      }
      details.push("WARNING: No overflow yet (historial insuficiente para prueba completa)");
    }

    const parentIssues = [];
    let ptr = msgEl.parentElement;
    let hop = 0;
    while (ptr && hop < 8) {
      const ov = readOverflow(ptr);
      const name = ptr.id ? `#${ptr.id}` : ptr.className ? `.${String(ptr.className).split(" ").join(".")}` : ptr.tagName;
      if (ov.y === "hidden" && !ptr.classList.contains("maya-chat-card")) {
        parentIssues.push(`${name} overflow-y hidden`);
      }
      ptr = ptr.parentElement;
      hop += 1;
    }
    if (parentIssues.length) {
      if (status !== STATUS_ERROR) status = STATUS_WARNING;
      explanation = "Hay contenedores padre que podrían bloquear scroll.";
      details.push(`WARNING: posibles bloqueos por overflow hidden (${parentIssues.length})`);
      details.push(...parentIssues.slice(0, 3));
    }

    const msgRect = msgEl.getBoundingClientRect();
    const inputRect = inputEl.getBoundingClientRect();
    const viewportH = win.innerHeight || doc.documentElement.clientHeight || 0;
    const inputNearBottom = viewportH > 0 ? viewportH - inputRect.bottom < 80 : false;
    const inputAfterMessages = inputRect.top >= msgRect.bottom - 8;
    details.push(`Input cerca del bottom viewport: ${inputNearBottom ? "sí" : "no"}`);
    details.push(`Input debajo del stream: ${inputAfterMessages ? "sí" : "no"}`);
    if ((!inputNearBottom || !inputAfterMessages) && status !== STATUS_ERROR) {
      status = STATUS_WARNING;
      explanation = "Layout de chat puede estar apilado incorrectamente.";
      details.push("WARNING: posible layout incorrecto (input no fijo al fondo)");
    }

    return { status, explanation, details };
  } catch (error) {
    return {
      status: STATUS_ERROR,
      explanation: "No se pudo ejecutar la prueba real de UI de Maya.",
      details: [`Error técnico: ${error instanceof Error ? error.message : String(error)}`],
    };
  } finally {
    if (iframe && iframe.parentElement) iframe.parentElement.removeChild(iframe);
  }
}

async function checkCollectionRead(pathParts) {
  const q = query(collection(db, ...pathParts), limit(1));
  const snap = await getDocs(q);
  return snap.size;
}

async function checkClientesHealth(scopeUid, businessId, incidentInfo) {
  const details = [];
  let status = STATUS_OK;
  let explanation = "Clientes responde correctamente.";
  try {
    const count = await getDocs(query(businessCollectionRef(db, scopeUid, businessId, "clients"), limit(1)));
    details.push(`Lectura de clients exitosa (muestra: ${count.size})`);
  } catch (error) {
    status = STATUS_ERROR;
    explanation = mapDiagnosticFriendlyMessage("client_save_failed", error instanceof Error ? error.message : String(error));
    details.push(`Error técnico: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (incidentInfo.count > 0 && status !== STATUS_ERROR) {
    status = STATUS_WARNING;
    explanation = "Clientes responde, pero hay incidentes guardados.";
    details.push(`Incidentes recientes de clientes: ${incidentInfo.count}`);
  }
  return { status, explanation, details, checkedAt: formatNow() };
}

async function checkPedidosHealth(scopeUid, businessId, incidentInfo) {
  const details = [];
  let status = STATUS_OK;
  let explanation = "Pedidos responde correctamente.";
  try {
    const count = await getDocs(query(businessCollectionRef(db, scopeUid, businessId, "orders"), limit(1)));
    details.push(`Lectura de orders exitosa (muestra: ${count.size})`);
  } catch (error) {
    status = STATUS_ERROR;
    explanation = mapDiagnosticFriendlyMessage("order_save_failed", error instanceof Error ? error.message : String(error));
    details.push(`Error técnico: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (incidentInfo.count > 0 && status !== STATUS_ERROR) {
    status = STATUS_WARNING;
    explanation = "Pedidos responde, pero hay incidentes guardados.";
    details.push(`Incidentes recientes de pedidos: ${incidentInfo.count}`);
  }
  return { status, explanation, details, checkedAt: formatNow() };
}

async function checkRecibosHealth(scopeUid, businessId, incidentInfo) {
  const details = [];
  let status = STATUS_OK;
  let explanation = "Recibos y enlace público disponibles.";
  try {
    const receiptSettingsRef = businessDocRef(db, scopeUid, businessId, "settings", "receipt");
    const receiptSettingsSnap = await getDoc(receiptSettingsRef);
    details.push(`Configuración de recibo: ${receiptSettingsSnap.exists() ? "disponible" : "pendiente de configurar"}`);
    const publicProbeRef = businessDocRef(db, scopeUid, businessId, "publicReceipts", "__diag_probe__");
    await getDoc(publicProbeRef);
    details.push("Regla de acceso get() para publicReceipts: accesible");
    if (!receiptSettingsSnap.exists()) {
      status = STATUS_WARNING;
      explanation = "Recibos operables, pero falta completar configuración del recibo.";
    }
  } catch (error) {
    status = STATUS_ERROR;
    explanation = mapDiagnosticFriendlyMessage("receipt_share_failed", error instanceof Error ? error.message : String(error));
    details.push(`Error técnico: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (incidentInfo.count > 0 && status === STATUS_OK) {
    status = STATUS_WARNING;
    explanation = "Recibos disponibles, pero hay incidentes recientes.";
    details.push(`Incidentes recientes de recibos: ${incidentInfo.count}`);
  }
  return { status, explanation, details, checkedAt: formatNow() };
}

async function checkProfileHealth(scopeUid, user, incidentInfo) {
  const details = [];
  let status = STATUS_OK;
  let explanation = "Perfil YourColor responde correctamente.";
  try {
    const businessDoc = await getDoc(profileDocRef(db, { uid: scopeUid, businessPath: `users/${scopeUid}/yourcolor` }));
    details.push(`Auth user activo: ${user?.uid ? "sí" : "no"}`);
    details.push(`Documento profile accesible: ${businessDoc.exists() ? "sí" : "no (formulario vacío permitido)"}`);
    if (!businessDoc.exists()) explanation = "Perfil vacío (permitido). Puedes guardar la configuración inicial.";
  } catch (error) {
    status = STATUS_ERROR;
    explanation = "No se pudo leer el perfil de YourColor.";
    details.push(`Error técnico: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (incidentInfo.count > 0 && status === STATUS_OK) {
    status = STATUS_WARNING;
    explanation = "Perfil responde, pero hay incidentes recientes.";
    details.push(`Incidentes recientes de perfil: ${incidentInfo.count}`);
  }
  return { status, explanation, details, checkedAt: formatNow() };
}

async function checkFinanzasHealth(scopeUid, businessId, incidentInfo) {
  const details = [];
  let status = STATUS_OK;
  let explanation = "Finanzas responde correctamente.";
  try {
    const movs = await getDocs(query(businessCollectionRef(db, scopeUid, businessId, "finances"), limit(1)));
    details.push(`Lectura de finances exitosa (muestra: ${movs.size})`);
  } catch (error) {
    status = STATUS_ERROR;
    explanation = "No se pudo validar Finanzas.";
    details.push(`Error técnico: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (incidentInfo.count > 0 && status === STATUS_OK) {
    status = STATUS_WARNING;
    explanation = "Finanzas responde, pero hay incidentes recientes.";
    details.push(`Incidentes recientes de finanzas: ${incidentInfo.count}`);
  }
  return { status, explanation, details, checkedAt: formatNow() };
}

async function checkEquipoHealth(scopeUid, businessId, incidentInfo) {
  const details = [];
  let status = STATUS_OK;
  let explanation = "Equipo responde correctamente.";
  try {
    const teamCount = await getDocs(query(businessCollectionRef(db, scopeUid, businessId, "team"), limit(1)));
    details.push(`Lectura de team exitosa (muestra: ${teamCount.size})`);
  } catch (error) {
    status = STATUS_ERROR;
    explanation = "No se pudo leer la información de Equipo.";
    details.push(`Error técnico: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (incidentInfo.count > 0 && status === STATUS_OK) {
    status = STATUS_WARNING;
    explanation = "Equipo responde, pero hay incidentes recientes.";
    details.push(`Incidentes recientes de Equipo: ${incidentInfo.count}`);
  }
  return { status, explanation, details, checkedAt: formatNow() };
}

function renderGeneral(results, rows) {
  const total = rows.length;
  const critical = rows.filter((r) => String(r.severity || "").toLowerCase() === "critical").length;
  const open = rows.filter((r) => r.resolved !== true).length;
  const errors = results.filter((x) => x.status === STATUS_ERROR).length;
  const warnings = results.filter((x) => x.status === STATUS_WARNING).length;
  let status = STATUS_OK;
  let explanation = "Módulos principales estables.";
  if (errors > 0) {
    status = STATUS_ERROR;
    explanation = "Hay módulos con errores activos que requieren atención.";
  } else if (warnings > 0 || open > 0) {
    status = STATUS_WARNING;
    explanation = "Hay advertencias o incidentes que conviene revisar.";
  }
  renderPanel("diag-general", {
    status,
    explanation,
    checkedAt: formatNow(),
    details: [
      `Paneles con error: ${errors}`,
      `Paneles con warning: ${warnings}`,
      `Incidencias guardadas: ${total}`,
      `Incidencias abiertas: ${open}`,
      `Incidencias críticas: ${critical}`,
    ],
  });
}

function renderRecommendation(rows, panelResults) {
  const el = document.getElementById("diag-recommendation");
  if (!el) return;
  const errorPanel = panelResults.find((panel) => panel.status === STATUS_ERROR);
  if (errorPanel) {
    el.innerHTML = `<p class="diag-state">Prioridad: corrige primero ${escapeHtml(
      errorPanel.name,
    )}, luego vuelve a correr el Diagnóstico.</p>`;
    return;
  }
  if (!rows.length) {
    el.innerHTML = `<p class="diag-state">Sin incidentes guardados, pero mantén monitoreo en Maya y Clientes.</p>`;
    return;
  }
  const top = rows[0];
  const text = String(top.technicalMessage || "").toLowerCase();
  let recommendation = "Revisa primero el incidente más reciente y valida si se reproduce.";
  if (/permission|insufficient/.test(text)) recommendation = "Prioridad: revisar reglas de Firestore y permisos por ownerUid.";
  else if (/network|fetch|timeout/.test(text)) recommendation = "Prioridad: confirmar conectividad y estabilidad del backend.";
  else if (/maya/.test(String(top.module || "").toLowerCase())) recommendation = "Prioridad: validar acción de Maya y escritura en Firestore.";
  el.innerHTML = `<p class="diag-state">${recommendation}</p>`;
}

async function loadDiagnostics(user) {
  showError("");
  const business = await resolveBusinessForUser(db, user);
  if (!business) {
    showError("No se encontró un negocio vinculado a esta cuenta.");
    return;
  }
  renderHeader(business);
  const data = business.data || {};
  const scopeUid = business?.scope?.uid || user.uid;
  const businessId = "yourcolor";
  const ownerUid = typeof data.ownerUid === "string" ? data.ownerUid.trim() : "";
  if (!ownerUid || ownerUid !== user.uid) {
    window.location.replace("dashboard.html");
    return;
  }

  setDiagnosticsLoggerContext({ businessId: business.id, ownerUid });
  const q = query(
    businessCollectionRef(db, scopeUid, businessId, "diagnostics"),
    orderBy("createdAt", "desc"),
    limit(80),
  );
  const snap = await getDocs(q);
  const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  const emptyEl = document.getElementById("diag-empty");
  if (emptyEl) emptyEl.hidden = true;

  const mayaIncidents = getIncidentSummary(rows, ["maya", "chat"]);
  const clientIncidents = getIncidentSummary(rows, ["cliente", "client"]);
  const orderIncidents = getIncidentSummary(rows, ["pedido", "order"]);
  const receiptIncidents = getIncidentSummary(rows, ["receipt", "recibo", "publicreceipt"]);
  const profileIncidents = getIncidentSummary(rows, ["profile", "config", "configuracion"]);
  const finanzasIncidents = getIncidentSummary(rows, ["finanza", "finance"]);
  const equipoIncidents = getIncidentSummary(rows, ["equipo", "team"]);

  const maya = await checkChatMayaHealth(business.id, mayaIncidents);
  const profile = await checkProfileHealth(scopeUid, user, profileIncidents);
  const clientes = await checkClientesHealth(scopeUid, businessId, clientIncidents);
  const pedidos = await checkPedidosHealth(scopeUid, businessId, orderIncidents);
  const finanzas = await checkFinanzasHealth(scopeUid, businessId, finanzasIncidents);
  const recibos = await checkRecibosHealth(scopeUid, businessId, receiptIncidents);
  const equipo = await checkEquipoHealth(scopeUid, businessId, equipoIncidents);

  renderPanel("diag-maya", maya);
  renderPanel("diag-firebase", profile);
  renderPanel("diag-clientes", clientes);
  renderPanel("diag-pedidos", pedidos);
  renderPanel("diag-whatsapp", finanzas);
  renderPanel("diag-recibos", recibos);
  renderPanel("diag-equipo", equipo);
  renderPanel("diag-architecture", {
    status: STATUS_OK,
    explanation: "Diagnóstico YourColor-only activo (sin checks de categorías/workspaces).",
    details: ["Se verifican solo profile, clients, orders, finances, team, receipts y maya."],
    checkedAt: formatNow(),
  });

  const panelResults = [
    { name: "Chat Maya", ...maya },
    { name: "Perfil", ...profile },
    { name: "Clientes", ...clientes },
    { name: "Pedidos", ...pedidos },
    { name: "Finanzas", ...finanzas },
    { name: "Recibos", ...recibos },
    { name: "Equipo", ...equipo },
  ];
  renderGeneral(panelResults, rows);
  renderRecommendation(rows, panelResults);
}

function boot() {
  initDashShell({ auth, db });
  wireGlobalDiagnosticsListeners("diagnostico");
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    loadDiagnostics(user).catch((error) => {
      console.error(error);
      showError("No se pudo cargar el Centro de Diagnóstico.");
    });
  });
}

boot();

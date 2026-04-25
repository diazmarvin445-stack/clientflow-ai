import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  collection,
  doc,
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
    const [chatHtmlRes, stylesRes] = await Promise.all([fetch("chat.html"), fetch("styles.css")]);
    const chatHtml = chatHtmlRes.ok ? await chatHtmlRes.text() : "";
    const stylesCss = stylesRes.ok ? await stylesRes.text() : "";
    const hasMessagesContainer = /id=["']yc-chat-stream["']/.test(chatHtml);
    const hasInput = /id=["']yc-chat-input["']/.test(chatHtml);
    const hasScrollableRule =
      /\.maya-chat-messages[\s\S]*overflow-y:\s*(auto|scroll)/i.test(stylesCss) ||
      /\.yc-chat-stream[\s\S]*overflow-y:\s*(auto|scroll)/i.test(stylesCss);
    details.push(`Contenedor de mensajes detectado: ${hasMessagesContainer ? "sí" : "no"}`);
    details.push(`Input de Maya detectado: ${hasInput ? "sí" : "no"}`);
    details.push(`Regla de scroll detectada en CSS: ${hasScrollableRule ? "sí" : "no"}`);
    if (!hasMessagesContainer || !hasInput || !hasScrollableRule) {
      status = STATUS_ERROR;
      explanation = "Faltan elementos o reglas clave para el chat Maya.";
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

async function checkCollectionRead(pathParts) {
  const q = query(collection(db, ...pathParts), limit(1));
  const snap = await getDocs(q);
  return snap.size;
}

async function checkClientesHealth(businessId, incidentInfo) {
  const details = [];
  let status = STATUS_OK;
  let explanation = "Clientes responde correctamente.";
  try {
    const count = await checkCollectionRead(["businesses", businessId, "clients"]);
    details.push(`Lectura de clients exitosa (muestra: ${count})`);
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

async function checkPedidosHealth(businessId, incidentInfo) {
  const details = [];
  let status = STATUS_OK;
  let explanation = "Pedidos responde correctamente.";
  try {
    const count = await checkCollectionRead(["businesses", businessId, "orders"]);
    details.push(`Lectura de orders exitosa (muestra: ${count})`);
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

async function checkRecibosHealth(businessId, incidentInfo) {
  const details = [];
  let status = STATUS_OK;
  let explanation = "Recibos y enlace público disponibles.";
  try {
    const receiptSettingsRef = doc(db, "businesses", businessId, "settings", "receipt");
    const receiptSettingsSnap = await getDoc(receiptSettingsRef);
    details.push(`Configuración de recibo: ${receiptSettingsSnap.exists() ? "disponible" : "pendiente de configurar"}`);
    const publicProbeRef = doc(db, "businesses", businessId, "publicReceipts", "__diag_probe__");
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

async function checkFirebaseHealth(businessId, user, incidentInfo) {
  const details = [];
  let status = STATUS_OK;
  let explanation = "Firebase autenticación y Firestore responden.";
  try {
    const businessDoc = await getDoc(doc(db, "businesses", businessId));
    details.push(`Auth user activo: ${user?.uid ? "sí" : "no"}`);
    details.push(`Documento de negocio accesible: ${businessDoc.exists() ? "sí" : "no"}`);
    if (!businessDoc.exists()) {
      status = STATUS_WARNING;
      explanation = "Firebase responde, pero el documento de negocio no se encontró.";
    }
  } catch (error) {
    status = STATUS_ERROR;
    explanation = mapDiagnosticFriendlyMessage("firebase_check_failed", error instanceof Error ? error.message : String(error));
    details.push(`Error técnico: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (incidentInfo.count > 0 && status === STATUS_OK) {
    status = STATUS_WARNING;
    explanation = "Firebase responde, pero hay incidentes recientes.";
    details.push(`Incidentes recientes de Firebase: ${incidentInfo.count}`);
  }
  return { status, explanation, details, checkedAt: formatNow() };
}

async function checkWhatsAppHealth(businessId, businessData, incidentInfo) {
  const details = [];
  let status = STATUS_WARNING;
  let explanation = "WhatsApp pendiente de configurar.";
  try {
    const convoCount = await checkCollectionRead(["businesses", businessId, "conversations"]);
    const hasConfig =
      Boolean(businessData?.whatsappPhoneNumberId) ||
      Boolean(businessData?.whatsappBusinessAccountId) ||
      Boolean(businessData?.whatsappConfigured);
    details.push(`Conversaciones detectadas: ${convoCount}`);
    details.push(`Configuración declarada: ${hasConfig ? "sí" : "pendiente"}`);
    if (hasConfig || convoCount > 0) {
      status = STATUS_OK;
      explanation = "WhatsApp muestra señales de configuración activa.";
    }
  } catch (error) {
    status = STATUS_ERROR;
    explanation = "No se pudo validar el módulo de WhatsApp.";
    details.push(`Error técnico: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (incidentInfo.count > 0 && status === STATUS_OK) {
    status = STATUS_WARNING;
    explanation = "WhatsApp activo, pero hay incidentes recientes.";
    details.push(`Incidentes recientes de WhatsApp: ${incidentInfo.count}`);
  }
  return { status, explanation, details, checkedAt: formatNow() };
}

async function checkEquipoHealth(businessId, incidentInfo) {
  const details = [];
  let status = STATUS_OK;
  let explanation = "Equipo responde correctamente.";
  try {
    const teamCount = await checkCollectionRead(["businesses", businessId, "teamMembers"]);
    details.push(`Lectura de teamMembers exitosa (muestra: ${teamCount})`);
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
  const ownerUid = typeof data.ownerUid === "string" ? data.ownerUid.trim() : "";
  if (!ownerUid || ownerUid !== user.uid) {
    window.location.replace("dashboard.html");
    return;
  }

  setDiagnosticsLoggerContext({ businessId: business.id, ownerUid });
  const q = query(collection(db, "businesses", business.id, "diagnostics"), orderBy("createdAt", "desc"), limit(80));
  const snap = await getDocs(q);
  const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  const emptyEl = document.getElementById("diag-empty");
  if (emptyEl) emptyEl.hidden = true;

  const mayaIncidents = getIncidentSummary(rows, ["maya", "chat"]);
  const clientIncidents = getIncidentSummary(rows, ["cliente", "client"]);
  const orderIncidents = getIncidentSummary(rows, ["pedido", "order"]);
  const receiptIncidents = getIncidentSummary(rows, ["receipt", "recibo", "publicreceipt"]);
  const firebaseIncidents = getIncidentSummary(rows, ["firebase", "firestore", "auth", "permission"]);
  const whatsappIncidents = getIncidentSummary(rows, ["whatsapp", "conversation"]);
  const equipoIncidents = getIncidentSummary(rows, ["equipo", "team"]);

  const maya = await checkChatMayaHealth(business.id, mayaIncidents);
  const clientes = await checkClientesHealth(business.id, clientIncidents);
  const pedidos = await checkPedidosHealth(business.id, orderIncidents);
  const recibos = await checkRecibosHealth(business.id, receiptIncidents);
  const firebase = await checkFirebaseHealth(business.id, user, firebaseIncidents);
  const whatsapp = await checkWhatsAppHealth(business.id, data, whatsappIncidents);
  const equipo = await checkEquipoHealth(business.id, equipoIncidents);

  renderPanel("diag-maya", maya);
  renderPanel("diag-clientes", clientes);
  renderPanel("diag-pedidos", pedidos);
  renderPanel("diag-recibos", recibos);
  renderPanel("diag-firebase", firebase);
  renderPanel("diag-whatsapp", whatsapp);
  renderPanel("diag-equipo", equipo);

  const panelResults = [
    { name: "Chat Maya", ...maya },
    { name: "Clientes", ...clientes },
    { name: "Pedidos", ...pedidos },
    { name: "Recibos", ...recibos },
    { name: "Firebase", ...firebase },
    { name: "WhatsApp", ...whatsapp },
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

import { db, auth } from "./firebase.js";
import { addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

/** @type {string} */
let diagnosticsBusinessId = "";

/** @type {string} */
let diagnosticsOwnerUid = "";
let globalListenersBound = false;

const MAX_MESSAGE_LENGTH = 500;
const MAX_METADATA_CHARS = 1000;

function clipText(value, max = MAX_MESSAGE_LENGTH) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function safeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value == null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = clipText(String(value), 180);
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.slice(0, 8).map((item) => clipText(String(item), 120));
      continue;
    }
    if (typeof value === "object") {
      try {
        out[key] = clipText(JSON.stringify(value), 220);
      } catch {
        out[key] = "[unserializable]";
      }
    }
  }
  const asString = JSON.stringify(out);
  if (asString.length > MAX_METADATA_CHARS) {
    return { summary: clipText(asString, MAX_METADATA_CHARS) };
  }
  return out;
}

export function mapDiagnosticFriendlyMessage(type, technicalMessage) {
  const text = String(technicalMessage || "").toLowerCase();
  if (/missing or insufficient permissions|permission-denied|insufficient permissions/.test(text)) {
    return "Firestore bloqueó esta acción. Probablemente falta permiso en las reglas para leer o guardar estos datos.";
  }
  if (/network|failed to fetch|offline|timeout/.test(text)) {
    return "No se pudo conectar al servidor en este momento. Revisa internet e inténtalo de nuevo.";
  }
  if (type === "receipt_share_failed") {
    return "No se pudo compartir el recibo. Puede ser permiso, navegador o link público no creado.";
  }
  if (type === "maya_action_failed") {
    return "Maya entendió el mensaje, pero no pudo ejecutar la acción en la base de datos.";
  }
  if (type === "client_save_failed") {
    return "No se pudo guardar el cliente. Verifica permisos o campos obligatorios.";
  }
  if (type === "order_save_failed") {
    return "No se pudo guardar el pedido. Revisa que el negocio y los datos estén completos.";
  }
  return "Se detectó un problema interno en la plataforma. Revisa los detalles técnicos para confirmar la causa.";
}

export function setDiagnosticsLoggerContext({ businessId, ownerUid } = {}) {
  diagnosticsBusinessId = typeof businessId === "string" ? businessId.trim() : "";
  diagnosticsOwnerUid = typeof ownerUid === "string" ? ownerUid.trim() : "";
}

export function currentDiagnosticsContext() {
  return {
    businessId: diagnosticsBusinessId,
    ownerUid: diagnosticsOwnerUid,
  };
}

export async function logPlatformIssue(type, module, technicalMessage, friendlyMessage, metadata = {}, severity = "medium") {
  const businessId = diagnosticsBusinessId;
  if (!businessId) return null;
  try {
    const message = clipText(technicalMessage || "Unknown issue");
    const mappedFriendly = clipText(
      friendlyMessage || mapDiagnosticFriendlyMessage(type, technicalMessage),
      MAX_MESSAGE_LENGTH,
    );
    const issue = {
      type: clipText(type || "unknown_issue", 80),
      module: clipText(module || "unknown_module", 80),
      technicalMessage: message,
      friendlyMessage: mappedFriendly,
      createdAt: serverTimestamp(),
      resolved: false,
      severity: ["low", "medium", "high", "critical"].includes(String(severity)) ? severity : "medium",
      ownerUid: diagnosticsOwnerUid || auth.currentUser?.uid || "",
      metadata: safeMetadata(metadata),
    };
    const ownerUid = diagnosticsOwnerUid || auth.currentUser?.uid || "";
    if (!ownerUid) return null;
    const ref = await addDoc(collection(db, "users", ownerUid, "yourcolor", "main", "diagnostics"), issue);
    return ref.id;
  } catch (error) {
    console.warn("[Diagnostics] logPlatformIssue failed", error);
    return null;
  }
}

export function wireGlobalDiagnosticsListeners(moduleName = "frontend") {
  if (globalListenersBound || typeof window === "undefined") return;
  globalListenersBound = true;
  window.addEventListener("error", (event) => {
    const message = event?.error?.message || event?.message || "window.error";
    void logPlatformIssue(
      "javascript_error",
      moduleName,
      message,
      "Se detectó un error de JavaScript en la interfaz.",
      {
        source: event?.filename || "",
        line: Number(event?.lineno || 0),
        column: Number(event?.colno || 0),
      },
      "medium",
    );
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const message = reason instanceof Error ? reason.message : String(reason || "unhandled rejection");
    void logPlatformIssue(
      "promise_rejection",
      moduleName,
      message,
      "Una operación interna falló sin manejo de error.",
      {},
      "medium",
    );
  });
}

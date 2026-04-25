import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { collection, getDocs, limit, orderBy, query } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { resolveBusinessForUser, formatBusinessMeta, initialsFromName } from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";
import {
  mapDiagnosticFriendlyMessage,
  setDiagnosticsLoggerContext,
  wireGlobalDiagnosticsListeners,
} from "./diagnostics-logger.js";

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

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

function severityLabel(value) {
  const s = String(value || "medium").toLowerCase();
  if (s === "critical") return "Crítica";
  if (s === "high") return "Alta";
  if (s === "low") return "Baja";
  return "Media";
}

function renderIssueList(targetId, rows, fallback = "Sin incidencias.") {
  const el = document.getElementById(targetId);
  if (!el) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    el.innerHTML = `<p class="diag-muted">${fallback}</p>`;
    return;
  }
  el.innerHTML = rows
    .slice(0, 6)
    .map((row) => {
      const friendly = row.friendlyMessage || mapDiagnosticFriendlyMessage(row.type, row.technicalMessage);
      return `<div class="diag-item">
        <p class="diag-item-title">${friendly}</p>
        <p class="diag-item-meta">${row.module || "módulo"} · ${severityLabel(row.severity)}</p>
      </div>`;
    })
    .join("");
}

function moduleBucket(rows, modules) {
  return rows.filter((row) => modules.some((m) => String(row.module || "").toLowerCase().includes(m)));
}

function renderGeneral(rows) {
  const el = document.getElementById("diag-general");
  if (!el) return;
  const total = rows.length;
  const critical = rows.filter((r) => String(r.severity || "").toLowerCase() === "critical").length;
  const open = rows.filter((r) => r.resolved !== true).length;
  const state = critical > 0 ? "Atención inmediata requerida." : open > 5 ? "Hay alertas activas por revisar." : "Estable con incidentes menores.";
  el.innerHTML = `
    <p class="diag-state">${state}</p>
    <p class="diag-metric">Incidencias: <strong>${total}</strong></p>
    <p class="diag-metric">Abiertas: <strong>${open}</strong></p>
    <p class="diag-metric">Críticas: <strong>${critical}</strong></p>
  `;
}

function renderRecommendation(rows) {
  const el = document.getElementById("diag-recommendation");
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = `<p class="diag-state">No se detectan fallas recientes. Puedes seguir operando con normalidad.</p>`;
    return;
  }
  const top = rows[0];
  const text = String(top.technicalMessage || "").toLowerCase();
  let recommendation = "Revisa primero el error más reciente y confirma si se repite al guardar.";
  if (/permission|insufficient/.test(text)) {
    recommendation = "Prioridad: revisar reglas de Firestore para ese módulo y validar ownerUid del negocio.";
  } else if (/network|fetch|timeout/.test(text)) {
    recommendation = "Prioridad: validar conexión, reintentar guardado y confirmar si el backend responde.";
  } else if (/maya/.test(String(top.module || "").toLowerCase())) {
    recommendation = "Prioridad: revisar la acción detectada por Maya y el payload enviado a Firestore.";
  }
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
  const gridEl = document.getElementById("diag-grid");
  const isEmpty = rows.length === 0;
  if (emptyEl) emptyEl.hidden = !isEmpty;
  if (gridEl) gridEl.hidden = isEmpty;
  if (isEmpty) return;

  renderGeneral(rows);
  renderIssueList("diag-recent", rows);
  renderIssueList("diag-firebase", moduleBucket(rows, ["firebase", "firestore", "auth"]), "Sin problemas recientes de Firebase.");
  renderIssueList("diag-maya", moduleBucket(rows, ["maya", "chat"]), "Sin problemas recientes de Maya.");
  renderIssueList("diag-clientes", moduleBucket(rows, ["cliente", "client"]), "Sin problemas recientes de clientes.");
  renderIssueList("diag-pedidos", moduleBucket(rows, ["pedido", "order", "receipt"]), "Sin problemas recientes de pedidos.");
  renderRecommendation(rows);
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

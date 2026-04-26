import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const YOURCOLOR_CONTEXT_KEY = "clientflow_yourcolor_context_v1";

function normalizeId(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return "";
  if (v === "construction_roofing") return "roofing_construction";
  return v;
}

export function getUrlContext() {
  return {};
}

function getSessionScoped(uid) {
  try {
    const raw = sessionStorage.getItem(YOURCOLOR_CONTEXT_KEY);
    if (!raw) return "";
    const row = JSON.parse(raw);
    if (!row || row.uid !== uid) return "";
    return "users/" + uid + "/yourcolor";
  } catch {
    return "";
  }
}

function setSessionScoped(uid) {
  if (!uid) return;
  try {
    sessionStorage.setItem(YOURCOLOR_CONTEXT_KEY, JSON.stringify({ uid, businessPath: `users/${uid}/yourcolor` }));
  } catch {
    /* ignore */
  }
}

export function ensureContextInUrl(_ctx) {
  return;
}

export function resolveAppContext(user) {
  const uid = String(user?.uid || "").trim();
  if (!uid) return null;
  setSessionScoped(uid);
  return { uid, businessPath: `users/${uid}/yourcolor` };
}

export function assertAppContext(ctx, moduleName = "modulo") {
  const uid = String(ctx?.uid || "").trim();
  const businessPath = String(ctx?.businessPath || "").trim();
  if (!uid || !businessPath) {
    const reason = `Contexto incompleto en ${moduleName}: uid/businessPath son obligatorios.`;
    throw new Error(reason);
  }
  return { uid, businessPath };
}

export async function requireAppContext(auth, moduleName = "modulo") {
  const user = auth.currentUser;
  const ctx = resolveAppContext(user);
  return assertAppContext(ctx, moduleName);
}

export function onAuthWithAppContext(auth, cb) {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cb(null, null);
      return;
    }
    const ctx = resolveAppContext(user);
    cb(user, ctx);
  });
}

export function ensureYourColorContext(user) {
  const uid = String(user?.uid || "").trim();
  if (!uid) return null;
  const ctx = { uid, businessPath: `users/${uid}/yourcolor` };
  setSessionScoped(uid);
  return ctx;
}

export function buildActiveFirestoreBasePath(ctx) {
  const safe = assertAppContext(ctx, "debug-path");
  return safe.businessPath;
}

export function isDevOrAdminUser(user) {
  const email = String(user?.email || "").toLowerCase();
  const byEmail = email.includes("marvin") || email.includes("admin");
  let byFlag = false;
  try {
    byFlag = localStorage.getItem("clientflow_dev_debug") === "1";
  } catch {
    byFlag = false;
  }
  return byEmail || byFlag;
}

export function renderContextDebugBadge({ user, moduleName, ctx, pathSuffix = "" }) {
  if (!isDevOrAdminUser(user) || !ctx) return;
  const rootId = "cf-context-debug";
  let root = document.getElementById(rootId);
  if (!root) {
    root = document.createElement("div");
    root.id = rootId;
    root.style.cssText =
      "position:fixed;bottom:10px;right:10px;z-index:99999;background:#111827;color:#e5e7eb;padding:10px 12px;border-radius:8px;font:12px/1.3 monospace;max-width:460px;box-shadow:0 10px 30px rgba(0,0,0,.35);opacity:.95;";
    document.body.appendChild(root);
  }
  const base = buildActiveFirestoreBasePath(ctx);
  const active = pathSuffix ? `${base}/${pathSuffix}` : base;
  root.innerHTML = [
    `<div><strong>DEBUG ${moduleName}</strong></div>`,
    `<div>uid: ${ctx.uid}</div>`,
    `<div>businessPath: ${active}</div>`,
  ].join("");
}

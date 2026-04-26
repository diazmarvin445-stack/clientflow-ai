import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const ACTIVE_CATEGORY_SESSION_KEY = "clientflow_active_category_v2";
const ACTIVE_WORKSPACE_SESSION_KEY = "clientflow_active_workspace_v1";

function normalizeId(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return "";
  if (v === "construction_roofing") return "roofing_construction";
  return v;
}

export function getUrlContext() {
  try {
    const u = new URL(window.location.href);
    return {
      workspaceId: normalizeId(u.searchParams.get("workspace")),
      categoryId: normalizeId(u.searchParams.get("category")),
    };
  } catch {
    return { workspaceId: "", categoryId: "" };
  }
}

function getSessionScoped(key, uid) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return "";
    const row = JSON.parse(raw);
    if (!row || row.uid !== uid) return "";
    return normalizeId(row.value);
  } catch {
    return "";
  }
}

function setSessionScoped(key, uid, value) {
  if (!uid || !value) return;
  try {
    sessionStorage.setItem(key, JSON.stringify({ uid, value: normalizeId(value) }));
  } catch {
    /* ignore */
  }
}

export function ensureContextInUrl({ workspaceId, categoryId }) {
  try {
    const u = new URL(window.location.href);
    if (workspaceId) u.searchParams.set("workspace", workspaceId);
    if (categoryId) u.searchParams.set("category", categoryId);
    window.history.replaceState({}, "", u.toString());
  } catch {
    /* ignore */
  }
}

export function resolveAppContext(user) {
  const uid = String(user?.uid || "").trim();
  if (!uid) return null;
  const workspaceId = "yourcolor";
  const categoryId = "custom_apparel";
  setSessionScoped(ACTIVE_WORKSPACE_SESSION_KEY, uid, workspaceId);
  setSessionScoped(ACTIVE_CATEGORY_SESSION_KEY, uid, categoryId);
  return { uid, workspaceId, categoryId };
}

export function assertAppContext(ctx, moduleName = "modulo") {
  const uid = String(ctx?.uid || "").trim();
  const workspaceId = normalizeId(ctx?.workspaceId);
  const categoryId = normalizeId(ctx?.categoryId);
  if (!uid || !workspaceId || !categoryId) {
    const reason = `Contexto incompleto en ${moduleName}: uid/workspace/category son obligatorios.`;
    throw new Error(reason);
  }
  return { uid, workspaceId, categoryId };
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
  const ctx = { uid, workspaceId: "yourcolor", categoryId: "custom_apparel" };
  setSessionScoped(ACTIVE_WORKSPACE_SESSION_KEY, uid, ctx.workspaceId);
  setSessionScoped(ACTIVE_CATEGORY_SESSION_KEY, uid, ctx.categoryId);
  return ctx;
}

export function buildActiveFirestoreBasePath(ctx) {
  const safe = assertAppContext(ctx, "debug-path");
  return `users/${safe.uid}/workspaces/${safe.workspaceId}/categories/${safe.categoryId}`;
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
    `<div>workspaceId: ${ctx.workspaceId}</div>`,
    `<div>categoryId: ${ctx.categoryId}</div>`,
    `<div>path: ${active}</div>`,
  ].join("");
}

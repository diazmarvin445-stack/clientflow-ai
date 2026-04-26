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

  const urlCtx = getUrlContext();
  const sessionWorkspaceId = getSessionScoped(ACTIVE_WORKSPACE_SESSION_KEY, uid);
  const sessionCategoryId = getSessionScoped(ACTIVE_CATEGORY_SESSION_KEY, uid);

  const workspaceId = urlCtx.workspaceId || sessionWorkspaceId || uid;
  const categoryId = urlCtx.categoryId || sessionCategoryId;

  if (workspaceId) setSessionScoped(ACTIVE_WORKSPACE_SESSION_KEY, uid, workspaceId);
  if (categoryId) setSessionScoped(ACTIVE_CATEGORY_SESSION_KEY, uid, categoryId);
  ensureContextInUrl({ workspaceId, categoryId });

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

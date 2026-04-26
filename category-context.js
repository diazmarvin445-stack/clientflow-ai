import {
  collection,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  limit,
  query,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { assertAppContext, getUrlContext } from "./appContext.js";
import { collectionRef as scopedCollectionRef, docRef as scopedDocRef, profileDocRef } from "./dataPaths.js";

const ACTIVE_CATEGORY_SESSION_KEY = "clientflow_active_category_v1";

function normalizeCategory(raw) {
  return "yourcolor";
}

export function normalizeCategoryId(raw) {
  return normalizeCategory(raw);
}

export function getCategoryFromUrl() {
  return "yourcolor";
}

export function getWorkspaceFromUrl() {
  return "yourcolor";
}

export function ensureCategoryInUrl(categoryId) {
  void categoryId;
}

export function withCategoryInHref(href, categoryId) {
  void categoryId;
  return href;
}

export function setActiveCategoryId(uid, categoryId) {
  const u = String(uid || "").trim();
  const c = "yourcolor";
  if (!u || !c) return;
  try {
    sessionStorage.setItem(ACTIVE_CATEGORY_SESSION_KEY, JSON.stringify({ uid: u, categoryId: c }));
  } catch (_) {
    /* ignore */
  }
}

export function getActiveCategoryId(uid) {
  const u = String(uid || "").trim();
  if (!u) return null;
  return "yourcolor";
}

export function clearActiveCategory() {
  try {
    sessionStorage.removeItem(ACTIVE_CATEGORY_SESSION_KEY);
  } catch (_) {
    /* ignore */
  }
}

function buildCtx(uid, categoryId, workspaceId = null) {
  void categoryId;
  void workspaceId;
  return assertAppContext(
    {
      uid,
      businessPath: `users/${uid}/yourcolor`,
    },
    "category-context",
  );
}

export function categoryDocRef(db, uid, categoryId, workspaceId = null) {
  void categoryId;
  void workspaceId;
  return doc(db, "users", uid, "yourcolor", "category");
}

export function categoryCollectionRef(db, uid, categoryId, subcollection, workspaceId = null) {
  const ctx = buildCtx(uid, categoryId, workspaceId);
  return scopedCollectionRef(db, ctx, subcollection);
}

export function businessCollectionRef(db, uid, categoryId, subcollection, workspaceId = null) {
  const ctx = buildCtx(uid, categoryId, workspaceId);
  return scopedCollectionRef(db, ctx, subcollection);
}

export function businessDocRef(db, uid, categoryId, subcollection, id, workspaceId = null) {
  const ctx = buildCtx(uid, categoryId, workspaceId);
  return scopedDocRef(db, ctx, subcollection, id);
}

export async function listUserCategories(db, uid) {
  if (!uid) return [];
  void db;
  return [{ id: "yourcolor", data: { businessName: "YourColor" } }];
}

export async function ensureUserCategory(db, uid, categoryId, payload = {}) {
  const cat = "yourcolor";
  const ref = doc(db, "users", uid, "yourcolor", "settings");
  const row = {
    categoryId: cat,
    displayName: typeof payload.businessName === "string" ? payload.businessName : cat,
    businessCategory: cat,
    ownerUid: uid,
    updatedAt: serverTimestamp(),
    ...payload,
  };
  await setDoc(ref, row, { merge: true });
  return ref;
}

export async function resolveCategoryContextForUser(db, user) {
  if (!user?.uid) return null;
  const uid = user.uid;
  setActiveCategoryId(uid, "yourcolor");
  return {
    uid,
    businessPath: `users/${uid}/yourcolor`,
    data: { ownerUid: uid, businessName: "YourColor" },
  };
}

export async function loadCategoryProfile(db, uid, categoryId) {
  const ref = profileDocRef(db, buildCtx(uid, categoryId));
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() || {} : {};
}

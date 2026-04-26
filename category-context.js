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

const ACTIVE_CATEGORY_SESSION_KEY = "clientflow_active_category_v1";

function normalizeCategory(raw) {
  const c = String(raw || "")
    .trim()
    .toLowerCase();
  if (c === "construction_roofing") return "roofing_construction";
  if (!c) return "ecommerce";
  return c;
}

export function normalizeCategoryId(raw) {
  return normalizeCategory(raw);
}

export function getCategoryFromUrl() {
  try {
    const u = new URL(window.location.href);
    const raw = u.searchParams.get("category");
    if (!raw) return null;
    const c = normalizeCategory(raw);
    return c || null;
  } catch {
    return null;
  }
}

export function ensureCategoryInUrl(categoryId) {
  const c = normalizeCategory(categoryId);
  if (!c) return;
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get("category") === c) return;
    u.searchParams.set("category", c);
    window.history.replaceState({}, "", u.toString());
  } catch {
    /* ignore */
  }
}

export function withCategoryInHref(href, categoryId) {
  const c = normalizeCategory(categoryId);
  if (!c || !href || /^https?:\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("tel:")) {
    return href;
  }
  const [baseAndQuery, hashPart] = String(href).split("#");
  const [basePath, queryPart] = baseAndQuery.split("?");
  const params = new URLSearchParams(queryPart || "");
  params.set("category", c);
  const q = params.toString();
  return `${basePath}${q ? `?${q}` : ""}${hashPart ? `#${hashPart}` : ""}`;
}

export function setActiveCategoryId(uid, categoryId) {
  const u = String(uid || "").trim();
  const c = normalizeCategory(categoryId);
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
  try {
    const raw = sessionStorage.getItem(ACTIVE_CATEGORY_SESSION_KEY);
    if (!raw) return null;
    const row = JSON.parse(raw);
    if (!row || row.uid !== u) return null;
    return normalizeCategory(row.categoryId);
  } catch {
    return null;
  }
}

export function clearActiveCategory() {
  try {
    sessionStorage.removeItem(ACTIVE_CATEGORY_SESSION_KEY);
  } catch (_) {
    /* ignore */
  }
}

export function categoryDocRef(db, uid, categoryId) {
  return doc(db, "users", uid, "categories", normalizeCategory(categoryId));
}

export function categoryCollectionRef(db, uid, categoryId, subcollection) {
  return collection(db, "users", uid, "categories", normalizeCategory(categoryId), subcollection);
}

export function businessCollectionRef(db, uid, categoryId, subcollection) {
  return collection(db, "users", uid, "business", normalizeCategory(categoryId), subcollection);
}

export function businessDocRef(db, uid, categoryId, subcollection, id) {
  return doc(db, "users", uid, "business", normalizeCategory(categoryId), subcollection, id);
}

export async function listUserCategories(db, uid) {
  if (!uid) return [];
  const col = collection(db, "users", uid, "categories");
  let snap;
  try {
    snap = await getDocsFromServer(query(col, limit(50)));
  } catch {
    snap = await getDocs(query(col, limit(50)));
  }
  return snap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));
}

export async function ensureUserCategory(db, uid, categoryId, payload = {}) {
  const cat = normalizeCategory(categoryId);
  const ref = categoryDocRef(db, uid, cat);
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
  const all = await listUserCategories(db, uid);
  const urlCat = getCategoryFromUrl();
  if (!all.length) {
    if (!urlCat) return null;
    setActiveCategoryId(uid, urlCat);
    ensureCategoryInUrl(urlCat);
    return {
      uid,
      categoryId: urlCat,
      data: {
        categoryId: urlCat,
        businessCategory: urlCat,
        category: urlCat,
        ownerUid: uid,
      },
    };
  }
  const sessionCat = getActiveCategoryId(uid);
  const chosen = (urlCat && all.find((x) => x.id === urlCat)) || (sessionCat ? all.find((x) => x.id === sessionCat) : null) || all[0];
  setActiveCategoryId(uid, chosen.id);
  ensureCategoryInUrl(chosen.id);
  return {
    uid,
    categoryId: chosen.id,
    data: chosen.data || {},
  };
}

export async function loadCategoryProfile(db, uid, categoryId) {
  const ref = doc(db, "users", uid, "business", normalizeCategory(categoryId), "profile");
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() || {} : {};
}

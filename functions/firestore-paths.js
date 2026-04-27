export function scopedBusinessIdFromContext(firebaseContext) {
  const c = firebaseContext && typeof firebaseContext === "object" ? firebaseContext : {};
  const uid =
    typeof c.ownerUid === "string" && c.ownerUid.trim()
      ? c.ownerUid.trim()
      : typeof c.uid === "string" && c.uid.trim()
        ? c.uid.trim()
        : "";
  const businessId = typeof c.businessId === "string" ? c.businessId.trim() : "";
  if (uid && (!businessId || businessId === "yourcolor")) {
    return `users/${uid}/yourcolor/main`;
  }
  return businessId;
}

export function businessDoc(db, businessId) {
  const id = String(businessId || "").trim();
  if (id.startsWith("users/")) return db.doc(id);
  return db.collection("businesses").doc(id);
}

export function businessCollection(db, businessId, subcollection) {
  const id = String(businessId || "").trim();
  const name = id.startsWith("users/") && subcollection === "finance" ? "finances" : subcollection;
  return businessDoc(db, id).collection(name);
}

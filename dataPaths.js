import { collection, doc } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { assertAppContext } from "./appContext.js";

function baseSegments(ctx) {
  const safe = assertAppContext(ctx, "dataPaths");
  return ["users", safe.uid, "yourcolor"];
}

export function categoryRootDocRef(db, ctx) {
  const parts = baseSegments(ctx);
  return doc(db, ...parts);
}

export function profileDocRef(db, ctx) {
  return doc(db, ...baseSegments(ctx), "profile");
}

export function settingsDocRef(db, ctx, id = "main") {
  return doc(db, ...baseSegments(ctx), "settings", String(id));
}

export function clientsColRef(db, ctx) {
  return collection(db, ...baseSegments(ctx), "clients");
}

export function clientDocRef(db, ctx, id) {
  return doc(db, ...baseSegments(ctx), "clients", String(id));
}

export function ordersColRef(db, ctx) {
  return collection(db, ...baseSegments(ctx), "orders");
}

export function orderDocRef(db, ctx, id) {
  return doc(db, ...baseSegments(ctx), "orders", String(id));
}

export function jobsColRef(db, ctx) {
  return collection(db, ...baseSegments(ctx), "orders");
}

export function jobDocRef(db, ctx, id) {
  return doc(db, ...baseSegments(ctx), "orders", String(id));
}

export function financesColRef(db, ctx) {
  return collection(db, ...baseSegments(ctx), "finances");
}

export function financeDocRef(db, ctx, id) {
  return doc(db, ...baseSegments(ctx), "finances", String(id));
}

export function teamColRef(db, ctx) {
  return collection(db, ...baseSegments(ctx), "team");
}

export function teamDocRef(db, ctx, id) {
  return doc(db, ...baseSegments(ctx), "team", String(id));
}

export function collectionRef(db, ctx, subcollection) {
  return collection(db, ...baseSegments(ctx), String(subcollection));
}

export function docRef(db, ctx, subcollection, id) {
  return doc(db, ...baseSegments(ctx), String(subcollection), String(id));
}

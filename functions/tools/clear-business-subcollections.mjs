/**
 * Borra todos los datos operativos bajo businesses/{businessId} (no el doc del negocio).
 * Uso (desde la carpeta functions, con credenciales de Admin):
 *   node tools/clear-business-subcollections.mjs <businessId>
 *
 * Credenciales: variable de entorno GOOGLE_APPLICATION_CREDENTIALS apuntando al JSON
 * de cuenta de servicio, o `firebase login` + Application Default Credentials.
 */

import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const businessId = process.argv[2];
if (!businessId || String(businessId).trim() === "") {
  console.error("Uso: node tools/clear-business-subcollections.mjs <businessId>");
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ credential: applicationDefault() });
}

const db = getFirestore();
const base = db.collection("businesses").doc(businessId);

async function deleteInBatches(q) {
  const snap = await q.limit(450).get();
  if (snap.empty) return false;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return true;
}

async function deleteCollection(coll) {
  for (;;) {
    const more = await deleteInBatches(coll.limit(450));
    if (!more) break;
  }
}

async function deleteConversationsWithMessages() {
  const convs = await base.collection("conversations").get();
  for (const c of convs.docs) {
    await deleteCollection(c.ref.collection("messages"));
    await c.ref.delete();
  }
}

const subcollections = [
  "leads",
  "jobs",
  "campaigns",
  "clients",
  "teamMembers",
  "orders",
  "finance",
  "calendar",
  "team",
  "meetingRequests",
  "specialRequests",
];

async function main() {
  const bizSnap = await base.get();
  if (!bizSnap.exists) {
    console.error(`No existe businesses/${businessId}`);
    process.exit(1);
  }
  console.log(`Limpiando subcolecciones de businesses/${businessId} …`);
  for (const name of subcollections) {
    await deleteCollection(base.collection(name));
    console.log(`  OK: ${name}`);
  }
  await deleteConversationsWithMessages();
  console.log("  OK: conversations (+ messages)");
  console.log("Listo. El documento del negocio (perfil) no se ha borrado.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

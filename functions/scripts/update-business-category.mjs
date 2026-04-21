/**
 * Actualiza `category` en `businesses/{id}`.
 *
 * Desde la carpeta `functions/`:
 *   set GOOGLE_APPLICATION_CREDENTIALS=ruta\serviceAccount.json
 *   set GOOGLE_CLOUD_PROJECT=clientflow-ai-7eb08
 *   node scripts/update-business-category.mjs
 *
 * Sin credenciales: Firebase Console → Firestore → businesses →
 * N768DiGBe4q1nD3fdUQY → category = "Custom Apparel" (string).
 */
import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "node:fs";

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "clientflow-ai-7eb08";
const BUSINESS_ID = process.env.CF_BUSINESS_ID || "N768DiGBe4q1nD3fdUQY";
const CATEGORY = process.env.CF_CATEGORY || "Custom Apparel";

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || "";
if (credPath && existsSync(credPath)) {
  const j = JSON.parse(readFileSync(credPath, "utf8"));
  initializeApp({ credential: cert(j), projectId: PROJECT_ID });
} else {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
}

const db = getFirestore();
const ref = db.collection("businesses").doc(BUSINESS_ID);
await ref.set({ category: CATEGORY, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
const snap = await ref.get();
console.log(`businesses/${BUSINESS_ID} category =`, snap.get("category"));

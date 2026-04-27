import { businessCollection } from "./firestore-paths.js";

const OPEN_ORDER_STATUSES = new Set(["nuevo", "produccion", "listo"]);

function normalizePhone(raw) {
  return String(raw ?? "").replace(/\D/g, "");
}

function normalizeStatus(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

function toIsoDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") {
    try {
      const d = v.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
    } catch {
      return null;
    }
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function resolveMayaActionEntities(db, businessId, action, normalizedPayload) {
  if (!businessId) {
    return {
      ok: false,
      error: "Falta businessId en contexto.",
      resolved: null,
      meta: { matchType: "none", confidence: "none", ambiguityStatus: "none" },
    };
  }
  const needsOrder =
    action === "set_order_expenses" || action === "mark_order_delivered";
  const needsClient =
    action === "update_client" || action === "delete_client" || action === "search_client";
  if (needsClient) {
    const clientsCol = businessCollection(db, businessId, "clients");
    const clientId = typeof normalizedPayload.clientId === "string" ? normalizedPayload.clientId.trim() : "";
    if (clientId) {
      const ref = clientsCol.doc(clientId);
      const snap = await ref.get();
      if (!snap.exists) {
        return {
          ok: false,
          error: "No encontré cliente con ese clientId.",
          resolved: null,
          meta: { matchType: "clientId", confidence: "high", ambiguityStatus: "none" },
        };
      }
      return {
        ok: true,
        error: "",
        resolved: { clientRef: ref, clientSnap: snap, clientId },
        meta: { matchType: "clientId", confidence: "high", ambiguityStatus: "none" },
      };
    }

    const targetPhone = normalizePhone(normalizedPayload.clientPhone);
    if (targetPhone) {
      const byNormalized = await clientsCol.where("normalizedPhone", "==", targetPhone).limit(2).get();
      if (byNormalized.size === 1) {
        const d = byNormalized.docs[0];
        return {
          ok: true,
          error: "",
          resolved: { clientRef: d.ref, clientSnap: d, clientId: d.id },
          meta: { matchType: "clientPhone", confidence: "high", ambiguityStatus: "none" },
        };
      }
      if (byNormalized.size > 1) {
        return {
          ok: false,
          error: "Ambiguo: hay varios clientes con ese teléfono.",
          resolved: {
            candidates: byNormalized.docs.map((d) => ({
              id: d.id,
              clientName: String(d.data()?.name || d.data()?.fullName || ""),
              phone: String(d.data()?.phone || ""),
            })),
            followUpQuestion: "Hay varios clientes con ese teléfono. ¿Me das el clientId exacto?",
          },
          meta: { matchType: "clientPhone", confidence: "low", ambiguityStatus: "ambiguous" },
        };
      }
      const byPhone = await clientsCol.where("phone", "==", targetPhone).limit(2).get();
      if (byPhone.size === 1) {
        const d = byPhone.docs[0];
        return {
          ok: true,
          error: "",
          resolved: { clientRef: d.ref, clientSnap: d, clientId: d.id },
          meta: { matchType: "clientPhone", confidence: "medium", ambiguityStatus: "none" },
        };
      }
    }

    const targetName = String(normalizedPayload.clientName ?? "").trim().toLowerCase();
    if (targetName) {
      const snap = await clientsCol.limit(250).get();
      const matches = snap.docs.filter((d) => {
        const row = d.data() || {};
        const n = String(row.name || row.fullName || "").trim().toLowerCase();
        if (!n) return false;
        return n.includes(targetName) || targetName.includes(n);
      });
      if (!matches.length) {
        return {
          ok: false,
          error: "No encontré cliente con ese nombre.",
          resolved: null,
          meta: { matchType: "clientName", confidence: "none", ambiguityStatus: "none" },
        };
      }
      if (matches.length > 1) {
        return {
          ok: false,
          error: "Ambiguo: encontré varios clientes con nombre similar.",
          resolved: {
            candidates: matches.slice(0, 6).map((d) => ({
              id: d.id,
              clientName: String(d.data()?.name || d.data()?.fullName || ""),
              phone: String(d.data()?.phone || ""),
            })),
            followUpQuestion: "Encontré varios clientes parecidos. ¿Confirmas el clientId exacto?",
          },
          meta: { matchType: "clientName", confidence: "low", ambiguityStatus: "ambiguous" },
        };
      }
      const d = matches[0];
      return {
        ok: true,
        error: "",
        resolved: { clientRef: d.ref, clientSnap: d, clientId: d.id },
        meta: { matchType: "clientName", confidence: "medium", ambiguityStatus: "none" },
      };
    }
    return {
      ok: false,
      error: "Necesito clientId, clientPhone o clientName para ubicar el cliente.",
      resolved: null,
      meta: { matchType: "none", confidence: "none", ambiguityStatus: "none" },
    };
  }

  if (!needsOrder) {
    return { ok: true, error: "", resolved: {}, meta: { matchType: "none", confidence: "high", ambiguityStatus: "none" } };
  }

  const ordersCol = businessCollection(db, businessId, "orders");
  const orderId = typeof normalizedPayload.orderId === "string" ? normalizedPayload.orderId.trim() : "";
  if (orderId) {
    const ref = ordersCol.doc(orderId);
    const snap = await ref.get();
    if (!snap.exists) {
      return {
        ok: false,
        error: "No encontré pedido con ese orderId.",
        resolved: null,
        meta: { matchType: "orderId", confidence: "high", ambiguityStatus: "none" },
      };
    }
    return {
      ok: true,
      error: "",
      resolved: { orderRef: ref, orderSnap: snap, orderId },
      meta: { matchType: "orderId", confidence: "high", ambiguityStatus: "none" },
    };
  }

  const targetName = String(normalizedPayload.clientName ?? "").trim().toLowerCase();
  const targetPhone = normalizePhone(normalizedPayload.clientPhone);
  const snap = await ordersCol.orderBy("createdAt", "desc").limit(120).get();
  const matches = [];
  snap.forEach((d) => {
    const row = d.data() || {};
    const status = normalizeStatus(row.status);
    if (!OPEN_ORDER_STATUSES.has(status)) return;
    if (targetName) {
      const n = String(row.clientName ?? "").trim().toLowerCase();
      if (!(n && (n.includes(targetName) || targetName.includes(n)))) return;
    }
    if (targetPhone) {
      const p = normalizePhone(row.clientPhone);
      if (p !== targetPhone) return;
    }
    matches.push({ ref: d.ref, snap: d });
  });

  if (matches.length === 0) {
    return {
      ok: false,
      error: "No hay pedido activo que coincida.",
      resolved: null,
      meta: { matchType: targetPhone ? "clientPhone" : "clientName", confidence: "none", ambiguityStatus: "none" },
    };
  }
  if (matches.length > 1) {
    const candidates = matches.slice(0, 5).map((m) => {
      const row = m.snap.data() || {};
      return {
        id: m.ref.id,
        clientName: String(row.clientName ?? ""),
        product: String(row.product ?? ""),
        total: Number(row.total ?? row.amount ?? 0) || 0,
        status: String(row.status ?? ""),
        date: toIsoDate(row.createdAt),
      };
    });
    return {
      ok: false,
      error: "Ambiguo: encontré varios pedidos activos. Necesito orderId o más detalle.",
      code: "AMBIGUOUS_ORDER",
      resolved: {
        candidates,
        followUpQuestion:
          "Veo varios pedidos parecidos. ¿Cuál quieres usar? Pásame el clientName exacto o el orderId.",
      },
      meta: { matchType: targetPhone ? "clientPhone" : "clientName", confidence: "low", ambiguityStatus: "ambiguous" },
    };
  }
  return {
    ok: true,
    error: "",
    resolved: {
      orderRef: matches[0].ref,
      orderSnap: matches[0].snap,
      orderId: matches[0].ref.id,
    },
    meta: { matchType: targetPhone ? "clientPhone" : "clientName", confidence: "medium", ambiguityStatus: "none" },
  };
}


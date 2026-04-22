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
  if (!needsOrder) {
    return { ok: true, error: "", resolved: {}, meta: { matchType: "none", confidence: "high", ambiguityStatus: "none" } };
  }

  const ordersCol = db.collection("businesses").doc(businessId).collection("orders");
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


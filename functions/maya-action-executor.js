import { businessCollection } from "./firestore-paths.js";

export async function executeMayaAction({
  db,
  businessId,
  action,
  normalizedPayload,
  resolved,
  handlers,
}) {
  const normalizeFixedFrequency = (raw) => {
    const f = String(raw || "monthly").toLowerCase();
    if (f === "weekly") return "weekly";
    if (f === "annual" || f === "yearly" || f === "anual") return "annual";
    return "monthly";
  };
  const resolutionMeta = resolved?.meta || null;
  if (action === "create_client") {
    const result = await handlers.syncClientRecord(db, businessId, {
      clientName: normalizedPayload.clientName,
      clientPhone: normalizedPayload.clientPhone,
      email: normalizedPayload.email,
      source: "chat-maya",
      markContact: true,
    });
    if (!result?.id) throw new Error("No se pudo crear el cliente.");
    return { ok: true, result: { clientId: result.id }, resolutionMeta };
  }

  if (action === "search_client") {
    if (!resolved?.clientRef || !resolved?.clientSnap) throw new Error("No se resolvió cliente para búsqueda.");
    const row = resolved.clientSnap.data() || {};
    return {
      ok: true,
      result: {
        clientId: resolved.clientRef.id,
        clientName: String(row.name || row.fullName || "Cliente"),
        phone: String(row.phone || ""),
        normalizedPhone: String(row.normalizedPhone || ""),
        status: String(row.status || ""),
      },
      resolutionMeta,
    };
  }

  if (action === "update_client") {
    if (!resolved?.clientRef || !resolved?.clientSnap) throw new Error("No se resolvió cliente para actualizar.");
    const prev = resolved.clientSnap.data() || {};
    const patch = {
      updatedAt: handlers.FieldValue.serverTimestamp(),
    };
    const nextName = typeof normalizedPayload.clientName === "string" ? normalizedPayload.clientName.trim() : "";
    const nextPhone =
      typeof normalizedPayload.clientPhone === "string" ? String(normalizedPayload.clientPhone).replace(/\D/g, "") : "";
    const nextEmail = typeof normalizedPayload.email === "string" ? normalizedPayload.email.trim() : "";
    if (nextName) {
      patch.name = nextName;
      patch.fullName = nextName;
    }
    if (nextPhone) {
      patch.phone = nextPhone;
      patch.normalizedPhone = nextPhone;
    } else if (!prev.normalizedPhone && prev.phone) {
      patch.normalizedPhone = String(prev.phone).replace(/\D/g, "");
    }
    if (nextEmail) patch.email = nextEmail;
    await resolved.clientRef.set(patch, { merge: true });
    return { ok: true, result: { clientId: resolved.clientRef.id }, resolutionMeta };
  }

  if (action === "delete_client") {
    if (!resolved?.clientRef) throw new Error("No se resolvió cliente para borrar.");
    await resolved.clientRef.delete();
    return { ok: true, result: { clientId: resolved.clientRef.id }, resolutionMeta };
  }

  if (action === "create_order") {
    const result = await handlers.processNewOrder(db, businessId, {
      clientName: normalizedPayload.clientName,
      clientPhone: normalizedPayload.clientPhone,
      product: normalizedPayload.product,
      quantity: normalizedPayload.quantity,
      total: normalizedPayload.total ?? normalizedPayload.amount,
      amount: normalizedPayload.amount ?? normalizedPayload.total,
      deposit: normalizedPayload.deposit,
      deliveryDate: normalizedPayload.deliveryDate ?? normalizedPayload.date,
      notes: normalizedPayload.notes,
      source: "chat_interno",
      createdBy: "maya",
      status: "nuevo",
    });
    return { ok: true, result, resolutionMeta };
  }

  if (action === "set_order_expenses") {
    if (!resolved?.orderRef) throw new Error("No se resolvió el pedido para actualizar gastos.");
    const exp = Math.max(0, Number(normalizedPayload.expenses) || 0);
    await resolved.orderRef.set(
      { expenses: exp, updatedAt: handlers.FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { ok: true, result: { orderId: resolved.orderId, expenses: exp }, resolutionMeta };
  }

  if (action === "mark_order_delivered") {
    if (!resolved?.orderRef || !resolved?.orderSnap) throw new Error("No se resolvió el pedido para entrega.");
    const order = resolved.orderSnap.data() || {};
    const result = await handlers.finalizeOrderDeliveryAndProfit(db, businessId, resolved.orderRef, order);
    return { ok: true, result, resolutionMeta };
  }

  if (action === "add_income") {
    const out = await handlers.mayaFinanceAddMovement(db, businessId, { data: normalizedPayload }, "income");
    return {
      ok: true,
      result: { kind: "income", amount: Number(normalizedPayload.amount) || 0, duplicate: out?.duplicate === true },
      resolutionMeta,
    };
  }

  if (action === "add_expense") {
    const out = await handlers.mayaFinanceAddMovement(db, businessId, { data: normalizedPayload }, "expense");
    return {
      ok: true,
      result: { kind: "expense", amount: Number(normalizedPayload.amount) || 0, duplicate: out?.duplicate === true },
      resolutionMeta,
    };
  }

  if (action === "search_finance") {
    const result = await handlers.mayaFinanceSearchMovements(db, businessId, { data: normalizedPayload });
    return { ok: true, result, resolutionMeta };
  }

  if (action === "add_fixed_expense") {
    const name = String(normalizedPayload.name || "").trim();
    const amt = Number(normalizedPayload.amount);
    if (!name) throw new Error("Falta nombre del gasto fijo.");
    if (!Number.isFinite(amt) || amt <= 0) throw new Error("Monto inválido.");
    const freq = normalizeFixedFrequency(normalizedPayload.frequency);
    const active = normalizedPayload.active !== false;
    const fcRaw = normalizedPayload.fechaCobro;
    const ds = typeof fcRaw === "string" ? fcRaw.trim() : String(fcRaw ?? "").trim();
    const fcDate = ds ? new Date(ds.includes("T") ? ds : `${ds.slice(0, 10)}T12:00:00`) : null;
    if (!fcDate || Number.isNaN(fcDate.getTime())) throw new Error("Fecha de cobro inválida (usa YYYY-MM-DD).");
    if (!handlers.Timestamp || typeof handlers.Timestamp.fromDate !== "function") {
      throw new Error("Timestamp no disponible en el ejecutor.");
    }
    /** @type {Record<string, unknown>} */
    const row = {
      name,
      amount: amt,
      frequency: freq,
      fechaCobro: handlers.Timestamp.fromDate(fcDate),
      chargeDayOfMonth: null,
      chargeWeekday: null,
      active,
      createdAt: handlers.FieldValue.serverTimestamp(),
      updatedAt: handlers.FieldValue.serverTimestamp(),
    };
    const ref = await businessCollection(db, businessId, "fixedExpenses").add(row);
    return { ok: true, result: { expenseId: ref.id, name }, resolutionMeta };
  }

  if (action === "update_fixed_expense") {
    const id = String(normalizedPayload.expenseId || "").trim();
    if (!id) throw new Error("Falta expenseId.");
    const ref = businessCollection(db, businessId, "fixedExpenses").doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Gasto fijo no encontrado.");
    const patch = { updatedAt: handlers.FieldValue.serverTimestamp() };
    if (typeof normalizedPayload.name === "string" && normalizedPayload.name.trim()) {
      patch.name = normalizedPayload.name.trim();
    }
    if (Number.isFinite(Number(normalizedPayload.amount)) && Number(normalizedPayload.amount) > 0) {
      patch.amount = Number(normalizedPayload.amount);
    }
    if (normalizedPayload.active === true || normalizedPayload.active === false) {
      patch.active = normalizedPayload.active;
    }
    if (normalizedPayload.frequency) {
      patch.frequency = normalizeFixedFrequency(normalizedPayload.frequency);
    }
    if (normalizedPayload.fechaCobro != null && String(normalizedPayload.fechaCobro).trim()) {
      const ds = String(normalizedPayload.fechaCobro).trim();
      const fcDate = new Date(ds.includes("T") ? ds : `${ds.slice(0, 10)}T12:00:00`);
      if (!Number.isNaN(fcDate.getTime()) && handlers.Timestamp?.fromDate) {
        patch.fechaCobro = handlers.Timestamp.fromDate(fcDate);
        patch.chargeDayOfMonth = null;
        patch.chargeWeekday = null;
      }
    }
    await ref.set(patch, { merge: true });
    return { ok: true, result: { expenseId: id }, resolutionMeta };
  }

  if (action === "delete_fixed_expense") {
    const id = String(normalizedPayload.expenseId || "").trim();
    if (!id) throw new Error("Falta expenseId.");
    const ref = businessCollection(db, businessId, "fixedExpenses").doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Gasto fijo no encontrado.");
    await ref.delete();
    return { ok: true, result: { expenseId: id }, resolutionMeta };
  }

  return { ok: false, result: { skipped: true, reason: `Unsupported action: ${action}` } };
}


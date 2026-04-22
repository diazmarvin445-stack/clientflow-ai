export async function executeMayaAction({
  db,
  businessId,
  action,
  normalizedPayload,
  resolved,
  handlers,
}) {
  const resolutionMeta = resolved?.meta || null;
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
    await handlers.mayaFinanceAddMovement(db, businessId, { data: normalizedPayload }, "income");
    return { ok: true, result: { kind: "income", amount: Number(normalizedPayload.amount) || 0 }, resolutionMeta };
  }

  if (action === "add_expense") {
    await handlers.mayaFinanceAddMovement(db, businessId, { data: normalizedPayload }, "expense");
    return { ok: true, result: { kind: "expense", amount: Number(normalizedPayload.amount) || 0 }, resolutionMeta };
  }

  return { ok: false, result: { skipped: true, reason: `Unsupported action: ${action}` } };
}


function fmtMoney(v) {
  const n = Number(v) || 0;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function buildMayaActionSuccessMessage(action, normalizedPayload, execResult, resolutionMeta = null) {
  if (action === "create_order") {
    const total = Number(normalizedPayload.total ?? normalizedPayload.amount) || 0;
    return `Listo. Guardé el pedido de ${normalizedPayload.clientName || "cliente"} por ${fmtMoney(total)} en Pedidos.`;
  }
  if (action === "set_order_expenses") {
    const expenses = Number(execResult?.expenses ?? normalizedPayload.expenses) || 0;
    return `Hecho. Actualicé gastos del pedido en ${fmtMoney(expenses)}.`;
  }
  if (action === "mark_order_delivered") {
    const totalPaid = Number(execResult?.totalPaid) || 0;
    const expenses = Number(execResult?.expenses) || 0;
    const net = Number(execResult?.netProfit) || totalPaid - expenses;
    return `Listo. Pedido marcado como entregado. Ingreso ${fmtMoney(totalPaid)}, gasto ${fmtMoney(expenses)}, neto ${fmtMoney(net)}.`;
  }
  if (action === "add_income") {
    const amount = Number(execResult?.amount ?? normalizedPayload.amount) || 0;
    return `Registrado. Ingreso por ${fmtMoney(amount)}.`;
  }
  if (action === "add_expense") {
    const amount = Number(execResult?.amount ?? normalizedPayload.amount) || 0;
    return `Registrado. Gasto por ${fmtMoney(amount)}.`;
  }
  if (resolutionMeta?.ambiguityStatus === "ambiguous" && resolutionMeta?.followUpQuestion) {
    return resolutionMeta.followUpQuestion;
  }
  return "";
}


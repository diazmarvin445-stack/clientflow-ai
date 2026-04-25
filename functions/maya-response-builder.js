function fmtMoney(v) {
  const n = Number(v) || 0;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function buildMayaActionSuccessMessage(action, normalizedPayload, execResult, resolutionMeta = null) {
  if (action === "create_client") {
    return `Listo. Guardé el cliente ${normalizedPayload.clientName || "cliente"} en CRM.`;
  }
  if (action === "update_client") {
    return `Hecho. Actualicé los datos del cliente ${normalizedPayload.clientName || ""}`.trim();
  }
  if (action === "delete_client") {
    return "Listo. Cliente eliminado correctamente.";
  }
  if (action === "search_client") {
    const name = String(execResult?.clientName || normalizedPayload.clientName || "Cliente");
    const phone = String(execResult?.phone || execResult?.normalizedPhone || normalizedPayload.clientPhone || "");
    const status = String(execResult?.status || "");
    const tail = [phone ? `Tel: ${phone}` : "", status ? `Estado: ${status}` : ""].filter(Boolean).join(" · ");
    return tail ? `Encontré a ${name}. ${tail}.` : `Encontré a ${name}.`;
  }
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
  if (action === "add_fixed_expense") {
    const name = String(execResult?.name ?? normalizedPayload.name ?? "gasto fijo");
    return `Listo. Agregué el gasto fijo «${name}» en Finanzas (recurrente).`;
  }
  if (action === "update_fixed_expense") {
    return "Hecho. Actualicé el gasto fijo en Finanzas.";
  }
  if (action === "delete_fixed_expense") {
    return "Listo. Eliminé ese gasto fijo de Finanzas.";
  }
  if (resolutionMeta?.ambiguityStatus === "ambiguous" && resolutionMeta?.followUpQuestion) {
    return resolutionMeta.followUpQuestion;
  }
  return "";
}


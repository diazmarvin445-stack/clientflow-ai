function toDateMaybe(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") {
    try {
      const d = v.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asOrderLite(row) {
  return {
    id: row?.id || null,
    clientName: String(row?.clientName || ""),
    product: String(row?.product || ""),
    total: Number(row?.total ?? row?.amount ?? 0) || 0,
    expenses: Number(row?.expenses ?? 0) || 0,
    balance: Number(row?.balance ?? 0) || 0,
    status: String(row?.status || ""),
    deliveryDate: toDateMaybe(row?.deliveryDate)?.toISOString() || null,
  };
}

export function buildMayaContextSnapshot(firebaseCtx) {
  const c = firebaseCtx && typeof firebaseCtx === "object" ? firebaseCtx : {};
  const orders = Array.isArray(c.orders) ? c.orders : [];
  const delivered = Array.isArray(c.ordersRecentDelivered) ? c.ordersRecentDelivered : [];
  const finance = Array.isArray(c.financeRecent) ? c.financeRecent : [];
  const clients = Array.isArray(c.clients) ? c.clients : [];

  const openOrders = orders
    .filter((o) => {
      const s = String(o?.status || "").trim().toLowerCase();
      return s !== "entregado" && s !== "cancelado";
    })
    .slice(0, 5)
    .map(asOrderLite);
  const deliveredOrders = delivered.slice(0, 5).map(asOrderLite);
  const pendingBalance = openOrders.reduce((sum, o) => sum + (Number(o.balance) || 0), 0);

  const financeRecent = finance.slice(0, 8).map((f) => ({
    id: f?.id || null,
    type: String(f?.type || ""),
    amount: Number(f?.amount || 0) || 0,
    category: String(f?.category || ""),
    status: String(f?.status || ""),
    orderId: String(f?.orderId || f?.linkedOrderId || ""),
  }));

  const linkedOrders = openOrders.filter((o) => clients.some((cRow) => String(cRow?.id || "") === String(o?.clientId || ""))).length;
  return {
    openOrders,
    deliveredOrders,
    pendingBalance,
    financeRecent,
    linkage: {
      clientsListed: clients.length,
      openOrdersListed: openOrders.length,
      deliveredOrdersListed: deliveredOrders.length,
      linkedOrders,
    },
  };
}


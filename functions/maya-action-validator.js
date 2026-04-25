import { MAYA_ACTION_FIELD_ALIASES, MAYA_ACTION_SCHEMAS } from "./maya-action-schemas.js";

function pickAliasedValue(data, canonical) {
  const aliases = MAYA_ACTION_FIELD_ALIASES[canonical] || [canonical];
  for (const key of aliases) {
    if (data[key] !== undefined && data[key] !== null && data[key] !== "") return data[key];
  }
  return undefined;
}

function asTrimmedString(v) {
  return typeof v === "string" ? v.trim() : "";
}

export function validateAndNormalizeMayaAction(action, payload) {
  const schema = MAYA_ACTION_SCHEMAS[action];
  if (!schema) {
    return {
      ok: false,
      error: `Acción no soportada por pipeline estricto: ${action}`,
      normalized: null,
    };
  }

  const data = payload && typeof payload === "object" ? { ...payload } : {};
  const normalized = { ...data };

  const totalRaw = pickAliasedValue(data, "total");
  if (totalRaw !== undefined) {
    const total = Number(totalRaw);
    if (Number.isFinite(total)) {
      normalized.total = total;
      normalized.amount = total;
    }
  }

  const amountRaw = pickAliasedValue(data, "amount");
  if (amountRaw !== undefined) {
    const amount = Number(amountRaw);
    if (Number.isFinite(amount)) normalized.amount = amount;
  }

  const nameRaw = pickAliasedValue(data, "clientName");
  if (nameRaw !== undefined) normalized.clientName = asTrimmedString(nameRaw);

  const phoneRaw = pickAliasedValue(data, "clientPhone");
  if (phoneRaw !== undefined) normalized.clientPhone = String(phoneRaw).replace(/\D/g, "");
  if (normalized.clientPhone) normalized.normalizedPhone = normalized.clientPhone;

  const clientIdRaw = pickAliasedValue(data, "clientId");
  if (clientIdRaw !== undefined) normalized.clientId = asTrimmedString(clientIdRaw);

  const expenseIdRaw = pickAliasedValue(data, "expenseId");
  if (expenseIdRaw !== undefined) normalized.expenseId = asTrimmedString(expenseIdRaw);

  const fixedExpenseNameRaw = pickAliasedValue(data, "fixedExpenseName");
  if (fixedExpenseNameRaw !== undefined) normalized.name = asTrimmedString(fixedExpenseNameRaw);

  const fechaCobroRaw = pickAliasedValue(data, "fechaCobro");
  if (fechaCobroRaw !== undefined) {
    const s = typeof fechaCobroRaw === "string" ? fechaCobroRaw.trim() : String(fechaCobroRaw).trim();
    if (s) {
      const d = new Date(s.includes("T") ? s : `${s.slice(0, 10)}T12:00:00`);
      if (!Number.isNaN(d.getTime())) normalized.fechaCobro = s.slice(0, 10);
    }
  }

  const confirmedRaw = pickAliasedValue(data, "confirmed");
  if (confirmedRaw !== undefined) normalized.confirmed = confirmedRaw === true;

  if (normalized.quantity !== undefined) {
    const q = Number(normalized.quantity);
    if (Number.isFinite(q)) normalized.quantity = q;
  }
  if (normalized.expenses !== undefined) {
    const e = Number(normalized.expenses);
    if (Number.isFinite(e)) normalized.expenses = e;
  }

  if (action === "add_fixed_expense" || action === "update_fixed_expense") {
    const freq = String(normalized.frequency ?? data.frequency ?? "monthly")
      .trim()
      .toLowerCase();
    normalized.frequency = freq === "weekly" || freq === "semanal" ? "weekly" : "monthly";
  }
  if (normalized.chargeDayOfMonth !== undefined) {
    const d = Number(normalized.chargeDayOfMonth);
    if (Number.isFinite(d)) normalized.chargeDayOfMonth = Math.floor(d);
  }
  if (normalized.chargeWeekday !== undefined) {
    const w = Number(normalized.chargeWeekday);
    if (Number.isFinite(w)) normalized.chargeWeekday = Math.floor(w);
  }
  if (normalized.active !== undefined) {
    normalized.active = normalized.active === true || normalized.active === "true" || normalized.active === 1;
  }

  for (const field of schema.required) {
    const v = normalized[field];
    if (v === undefined || v === null || v === "") {
      return { ok: false, error: `Falta campo requerido: ${field}`, normalized: null };
    }
    if ((field === "total" || field === "amount") && !(Number(v) > 0)) {
      return { ok: false, error: "El monto total del pedido es obligatorio y mayor que cero.", normalized: null };
    }
  }

  if (schema.requiresOneOf && schema.requiresOneOf.length) {
    const hasAny = schema.requiresOneOf.some((k) => {
      const v = normalized[k];
      return !(v === undefined || v === null || v === "");
    });
    if (!hasAny) {
      return {
        ok: false,
        error: `Debes indicar uno de estos campos: ${schema.requiresOneOf.join(", ")}`,
        normalized: null,
      };
    }
  }

  if (action === "delete_client" && normalized.confirmed !== true) {
    return {
      ok: false,
      error: "¿Confirmas borrar este cliente? Responde con confirmed:true y el clientId o nombre exacto.",
      normalized: null,
    };
  }

  if (action === "set_order_expenses" && !(Number(normalized.expenses) >= 0)) {
    return { ok: false, error: "Monto de gastos inválido.", normalized: null };
  }
  if ((action === "add_income" || action === "add_expense") && !(Number(normalized.amount) > 0)) {
    return { ok: false, error: "Monto inválido para movimiento financiero.", normalized: null };
  }
  if (action === "add_fixed_expense" && !(Number(normalized.amount) > 0)) {
    return { ok: false, error: "Monto inválido para gasto fijo.", normalized: null };
  }
  if (action === "add_fixed_expense") {
    const fc = normalized.fechaCobro;
    if (!fc || typeof fc !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fc)) {
      return { ok: false, error: "Indica fechaCobro en formato YYYY-MM-DD (fecha completa de cobro).", normalized: null };
    }
    const test = new Date(`${fc}T12:00:00`);
    if (Number.isNaN(test.getTime())) {
      return { ok: false, error: "La fecha de cobro no es válida.", normalized: null };
    }
  }

  return { ok: true, error: "", normalized };
}


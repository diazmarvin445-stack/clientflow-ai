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

  if (normalized.quantity !== undefined) {
    const q = Number(normalized.quantity);
    if (Number.isFinite(q)) normalized.quantity = q;
  }
  if (normalized.expenses !== undefined) {
    const e = Number(normalized.expenses);
    if (Number.isFinite(e)) normalized.expenses = e;
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

  if (action === "set_order_expenses" && !(Number(normalized.expenses) >= 0)) {
    return { ok: false, error: "Monto de gastos inválido.", normalized: null };
  }
  if ((action === "add_income" || action === "add_expense") && !(Number(normalized.amount) > 0)) {
    return { ok: false, error: "Monto inválido para movimiento financiero.", normalized: null };
  }

  return { ok: true, error: "", normalized };
}


export const MAYA_ACTION_SCHEMAS = {
  create_client: {
    required: [],
    requiresOneOf: ["clientName", "clientPhone"],
  },
  update_client: {
    required: [],
    requiresOneOf: ["clientId", "clientName", "clientPhone"],
  },
  delete_client: {
    required: [],
    requiresOneOf: ["clientId", "clientName", "clientPhone"],
  },
  search_client: {
    required: [],
    requiresOneOf: ["clientId", "clientName", "clientPhone"],
  },
  create_order: {
    required: ["clientName", "product", "quantity", "total"],
  },
  set_order_expenses: {
    required: ["expenses"],
    requiresOneOf: ["orderId", "clientName", "clientPhone"],
  },
  mark_order_delivered: {
    required: [],
    requiresOneOf: ["orderId", "clientName", "clientPhone"],
  },
  add_income: {
    required: ["amount"],
  },
  add_expense: {
    required: ["amount"],
  },
  search_finance: {
    required: [],
  },
  add_fixed_expense: {
    required: ["name", "amount", "fechaCobro"],
  },
  update_fixed_expense: {
    required: ["expenseId"],
  },
  delete_fixed_expense: {
    required: ["expenseId"],
  },
};

export const MAYA_ACTION_FIELD_ALIASES = {
  total: ["total", "amount", "monto", "price"],
  amount: ["amount", "total", "monto", "price"],
  clientName: ["clientName", "customerName", "name"],
  clientPhone: ["clientPhone", "phone", "telefono", "whatsapp"],
  clientId: ["clientId", "id"],
  expenseId: ["expenseId", "fixedExpenseId"],
  fixedExpenseName: ["name", "nombre", "titulo", "description"],
  fechaCobro: ["fechaCobro", "date", "fecha", "fecha_cobro"],
  confirmed: ["confirmed", "confirm", "isConfirmed"],
};

export function hasMayaActionSchema(action) {
  return Boolean(MAYA_ACTION_SCHEMAS[action]);
}


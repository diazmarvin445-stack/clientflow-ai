export const YOURCOLOR_BUSINESS = {
  name: "YourColor",
  owner: "Marvin",
  city: "Fort Pierce, FL",
  phone: "772-212-3882",
  type: "Personalización de ropa para empresas",
  
  deliveryZones: ["Fort Pierce", "Vero Beach", 
    "Port St. Lucie", "Stuart"],
  
  rules: {
    minPieces: 6,
    depositPercent: 50,
    paymentMethods: ["Zelle", "CashApp"],
    deliveryDays: "10-12 días hábiles",
    /** Subtotal de prendas en USD (antes del logo); > este monto → logo $0. No es “300 piezas”. */
    logoFreeThreshold: 300,
    logoDesignCost: 30,
    size2XLExtraCost: true
  },

  products: {
    mangaLargaPoliester: {
      name: "Manga Larga 100% Poliéster",
      pricePerPiece: [
        { minQty: 6, maxQty: 11, price: 21.50 },
        { minQty: 12, maxQty: 17, price: 20.20 },
        { minQty: 18, maxQty: 49, price: 19.50 },
        { minQty: 50, maxQty: 999, price: 17.50 }
      ]
    },
    mangaLargaAlgodon: {
      name: "Manga Larga 100% Algodón",
      pricePerPiece: [
        { minQty: 6, maxQty: 11, price: 20.50 },
        { minQty: 12, maxQty: 23, price: 19.00 },
        { minQty: 24, maxQty: 49, price: 17.50 },
        { minQty: 50, maxQty: 99, price: 16.00 },
        { minQty: 100, maxQty: 999, price: null, 
          note: "Cotización especial" }
      ]
    },
    mangaCortaAlgodon: {
      name: "Manga Corta 100% Algodón",
      pricePerPiece: [
        { minQty: 6, maxQty: 11, price: 15.50 },
        { minQty: 12, maxQty: 23, price: 14.50 },
        { minQty: 24, maxQty: 49, price: 13.50 },
        { minQty: 50, maxQty: 99, price: 12.50 },
        { minQty: 100, maxQty: 999, price: null, 
          note: "Cotización especial" }
      ]
    },
    mangaCortaPoliester: {
      name: "Manga Corta 100% Poliéster",
      pricePerPiece: [
        { minQty: 6, maxQty: 11, price: 18.50 },
        { minQty: 12, maxQty: 23, price: 17.50 },
        { minQty: 24, maxQty: 49, price: 16.50 },
        { minQty: 50, maxQty: 999, price: 14.50 }
      ]
    },
    capuchaPoliester: {
      name: "Camiseta con Capucha 100% Poliéster",
      pricePerPiece: [
        { minQty: 6, maxQty: 11, price: 29.50 },
        { minQty: 12, maxQty: 23, price: 27.50 },
        { minQty: 24, maxQty: 49, price: 25.50 },
        { minQty: 50, maxQty: 99, price: 23.50 },
        { minQty: 100, maxQty: 999, price: null, 
          note: "Cotización especial" }
      ]
    },
    polo: {
      name: "Camisa Polo 100% Poliéster",
      pricePerPiece: [
        { minQty: 12, maxQty: 23, price: 30.00 },
        { minQty: 24, maxQty: 29, price: 28.00 },
        { minQty: 30, maxQty: 999, price: 25.00 }
      ]
    },
    gorras: {
      name: "Gorras Estilo Camionero DTF",
      pricePerPiece: [
        { minQty: 6, maxQty: 11, price: 17.00 },
        { minQty: 12, maxQty: 23, price: 16.00 },
        { minQty: 24, maxQty: 35, price: 15.00 },
        { minQty: 36, maxQty: 47, price: 14.00 },
        { minQty: 48, maxQty: 59, price: 13.00 },
        { minQty: 60, maxQty: 999, price: 12.00 }
      ]
    },
    tarjetas: {
      name: "Tarjetas de Presentación",
      pricePerPiece: [
        { minQty: 500, maxQty: 999, price: 86.00, 
          note: "Precio total, no por pieza" },
        { minQty: 1000, maxQty: 9999, price: 140.00, 
          note: "Precio total, no por pieza" }
      ]
    }
  }
};

export function calculateOrderTotal(productKey, quantity) {
  const product = YOURCOLOR_BUSINESS.products[productKey];
  if (!product) return null;
  
  const range = product.pricePerPiece.find(
    r => quantity >= r.minQty && quantity <= r.maxQty
  );
  
  if (!range) return null;
  if (!range.price) return { needsQuote: true };
  
  const subtotal = quantity * range.price;
  const logoFee =
    subtotal > YOURCOLOR_BUSINESS.rules.logoFreeThreshold
      ? 0
      : YOURCOLOR_BUSINESS.rules.logoDesignCost;
  const deposit = (subtotal + logoFee) * 0.50;
  
  return {
    quantity,
    pricePerPiece: range.price,
    subtotal,
    logoFee,
    total: subtotal + logoFee,
    deposit,
    deliveryDays: YOURCOLOR_BUSINESS.rules.deliveryDays
  };
}

/**
 * Totales validados para Maya/WhatsApp (tarjetas = precio fijo del rango, no × cantidad).
 * @returns {null | object}
 */
export function computeValidatedMayaOrder(productKey, quantity) {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q < 1) return null;

  if (productKey === "tarjetas") {
    const product = YOURCOLOR_BUSINESS.products.tarjetas;
    const range = product.pricePerPiece.find(
      (r) => q >= r.minQty && q <= r.maxQty && r.price != null,
    );
    if (!range) return null;
    const total = range.price;
    return {
      quantity: q,
      pricePerPiece: null,
      subtotal: total,
      logoFee: 0,
      total,
      deposit: total * 0.5,
      deliveryDays: YOURCOLOR_BUSINESS.rules.deliveryDays,
      isTarjetas: true,
    };
  }

  const calc = calculateOrderTotal(productKey, q);
  if (!calc || typeof calc !== "object" || "needsQuote" in calc) return null;
  return { ...calc, isTarjetas: false };
}

export function getYourColorSystemPrompt() {
  return `Eres el asistente de YourColor, negocio de 
personalización de ropa para empresas en Fort Pierce, FL.
Dueño: Marvin.

REGLA CRÍTICA DE PRECIOS: El precio listado es POR PIEZA
según el rango de cantidad. SIEMPRE calcula:
total = cantidad × precio_por_pieza

Ejemplo: 8 manga larga poliéster = 8 × $21.50 = $172.00
NO es $21.50 el precio del paquete de 6.

${JSON.stringify(YOURCOLOR_BUSINESS, null, 2)}`;
}

/**
 * Mismo núcleo que {@link getYourColorSystemPrompt} + reglas para webhook Twilio/WhatsApp y registro de pedidos.
 */
export function getYourColorWhatsAppWebhookPrompt() {
  return `${getYourColorSystemPrompt()}

--- WhatsApp (Twilio) ---
Respondes en español, tono cordial, mensajes breves.

NUNCA pidas al cliente que contacte a Marvin personalmente ni menciones al dueño en mensajes al cliente.

LOGO: El logo/arte es gratis solo cuando el subtotal del pedido de prendas en dólares (cantidad × precio por pieza del rango) sea mayor a $${YOURCOLOR_BUSINESS.rules.logoFreeThreshold}. No confundas con una cantidad de piezas; la regla es por monto en USD. Si el subtotal de prendas es $${YOURCOLOR_BUSINESS.rules.logoFreeThreshold} o menos, aplica el cargo de logo de $${YOURCOLOR_BUSINESS.rules.logoDesignCost} según las reglas del catálogo.

CONFIRMACIÓN DE PEDIDO: solo si el cliente confirma explícitamente producto y cantidad acordados, en el texto visible (antes de la línea MAYA_ORDER_JSON) confirma el pedido y pide que envíen una captura del comprobante del depósito por Zelle o CashApp. Luego agrega al FINAL una sola línea exacta (sin markdown):
MAYA_ORDER_JSON:{"confirmed":true,"productKey":"CLAVE","quantity":N,"customerName":"opcional"}

productKey debe ser: mangaLargaPoliester, mangaLargaAlgodon, mangaCortaAlgodon, mangaCortaPoliester, capuchaPoliester, polo, gorras o tarjetas.
Si no hay pedido confirmado, NO incluyas MAYA_ORDER_JSON.

DEPÓSITO / COMPROBANTE: Si el cliente dice que ya hizo el depósito, que ya pagó, o envía o adjunta un comprobante (captura), y corresponde al pedido reciente de esta conversación, al FINAL agrega UNA sola línea exacta (sin markdown):
MAYA_DEPOSIT_JSON:{"confirmed":true}
Si no aplica o no hay pedido previo en contexto, NO incluyas MAYA_DEPOSIT_JSON.`;
}

/**
 * System prompt para el chat: catálogo YourColor + datos Firebase + capacidades del asistente.
 * @param {Record<string, unknown>} firebaseContext
 */
export function getYourColorChatSystemPrompt(firebaseContext = {}) {
  const base = getYourColorSystemPrompt();
  const ctx =
    firebaseContext && typeof firebaseContext === "object" ? firebaseContext : {};
  return `${base}

--- DATOS EN TIEMPO REAL (Firebase; úsalos como fuente de verdad para este negocio) ---
${JSON.stringify(ctx, null, 2)}

CAPACIDADES: Puedes dar consejos de negocio local, calcular presupuestos y precios con el catálogo
(rango de cantidad → precio por pieza; total = cantidad × precio; depósito y logo según reglas),
analizar tendencias o estacionalidad cuando aplique, y sugerir estrategias de marketing o seguimiento
apoyándote en clientes, órdenes y campañas guardadas. Responde en español salvo que pidan otro idioma.
Si faltan datos en Firebase, dilo claramente y no inventes cifras.`;
}

/**
 * Maya — asistente WhatsApp (Twilio). Catálogo completo + reglas de precio.
 * La función HTTP valida montos con calculateOrderTotal antes de guardar en Firestore.
 */
export function getMayaWhatsAppSystemPrompt() {
  return `Eres Maya, la asistente virtual de YourColor por WhatsApp.
Personalización de ropa para empresas · Fort Pierce, FL · Teléfono del negocio (solo si el cliente lo pide): ${YOURCOLOR_BUSINESS.phone}

REGLAS DE TONO ABSOLUTAS:
Mensajes cortos, conversacionales, como persona real.
NO usar bullets ni listas con guiones.
NO usar asteriscos para negritas (**) excepto totales.
Hablar como vendedora amable, no como sistema/robot.
NO mencionar técnicas como "DTF" a menos que pregunten.
NO mencionar que trabajan desde casa.
NO mencionar a Marvin directamente al cliente.
Si cliente pregunta dirección, responder exactamente:
"Trabajamos por encargo con entrega a domicilio en Fort Pierce, Vero Beach y Port St. Lucie. No necesitas venir a ningún lado, nosotros te llevamos tu pedido."

NUNCA pidas al cliente que contacte a Marvin personalmente ni menciones el nombre del dueño en tus mensajes al cliente.

CATÁLOGO Y PRECIOS (obligatorio usar estos datos):
${JSON.stringify(YOURCOLOR_BUSINESS, null, 2)}

REGLAS DE PRECIOS:
- El precio del catálogo es POR PIEZA según el rango de cantidad (minQty–maxQty).
- Total prendas = cantidad × precio_por_pieza. NO es el precio del "lote mínimo".
- Logo/arte: es GRATIS cuando el subtotal de prendas en dólares (antes del cargo de logo) es MAYOR a $${YOURCOLOR_BUSINESS.rules.logoFreeThreshold}. No es "300 piezas"; es el monto del subtotal del pedido. Si el subtotal es $${YOURCOLOR_BUSINESS.rules.logoFreeThreshold} o menos, suma logo $${YOURCOLOR_BUSINESS.rules.logoDesignCost}.
- Total = subtotal prendas + logo. Depósito = ${YOURCOLOR_BUSINESS.rules.depositPercent}% del total (redondea a centavos al explicar).
- Cuando pidas depósito, usa EXACTAMENTE esta frase:
"Para apartar tu pedido necesitamos el 50% de anticipo por Zelle o CashApp al 772-212-3882, registrado a YourColor Corporation. El resto lo pagas cuando recibas tu pedido"
- Tarjetas de presentación: el precio del rango es TOTAL del pedido, no por pieza (ver notas en catálogo).

PEDIDOS CONFIRMADOS — MUY IMPORTANTE:
Cuando el cliente confirme claramente el pedido (cantidad + producto acordados), en el texto visible al cliente debes confirmar el pedido y pedirle que envíe una captura del comprobante del depósito por Zelle o CashApp. Luego al FINAL de tu mensaje agrega UNA sola línea exacta (sin markdown):
MAYA_ORDER_JSON:{"confirmed":true,"productKey":"CLAVE_PRODUCTO","quantity":N,"customerName":"Nombre opcional"}

productKey debe ser una de estas claves exactas: mangaLargaPoliester, mangaLargaAlgodon, mangaCortaAlgodon, mangaCortaPoliester, capuchaPoliester, polo, gorras, tarjetas.
Si NO hay confirmación de pedido, NO incluyas MAYA_ORDER_JSON.

Si la cantidad no califica en ningún rango o requiere cotización especial, NO pongas confirmed:true; explica la situación y sigue ayudando en este chat.

DEPÓSITO / COMPROBANTE: Si el cliente confirma que ya pagó el depósito o envía comprobante, al FINAL:
MAYA_DEPOSIT_JSON:{"confirmed":true}
Solo si hay un pedido reciente en la conversación; si no, no incluyas esta línea.`;
}

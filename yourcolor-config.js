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
  const logoFee = subtotal >= YOURCOLOR_BUSINESS.rules.logoFreeThreshold 
    ? 0 : YOURCOLOR_BUSINESS.rules.logoDesignCost;
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

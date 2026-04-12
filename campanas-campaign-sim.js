/**
 * Simulated “AI” campaign recommendations from business profile (no OpenAI).
 * Tuned for realistic ranges; deterministic variation via profile hash.
 */
import { SERVICE_LABELS } from "./dashboard-data.js";

/** @typedef {'landscaping'|'cleaning'|'pressure_washing'|'roofing'|'generic'} Vertical */

const KW = {
  roofing: /\b(roof|roofing|tejad|cubierta|impermeabil|canal[oó]n|gutter|shingle)\b/i,
  cleaning: /\b(cleaning|clean|limpieza|limpi|maid|domést|domestic|hogar)\b/i,
  pressure: /\b(pressure\s*wash|hidrolimpi|power\s*wash|pressure-washing)\b/i,
  landscape: /\b(landscape|landscaping|jard[ií]n|lawn|cesped|césped|paisaj|tree|árbol|poda)\b/i,
};

function norm(s) {
  return typeof s === "string" ? s.trim() : "";
}

function hashStr(s) {
  let h = 0;
  const str = norm(s);
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * @param {string[]} services
 * @param {string} description
 * @param {string} businessName
 */
export function detectVertical(services, description, businessName) {
  const text = `${norm(businessName)} ${norm(description)}`.toLowerCase();
  const svc = Array.isArray(services) ? services : [];

  if (svc.includes("pressure-washing") || KW.pressure.test(text)) return "pressure_washing";
  if (KW.roofing.test(text)) return "roofing";
  if (KW.cleaning.test(text)) return "cleaning";
  if (
    svc.includes("landscaping") ||
    svc.includes("lawn-care") ||
    svc.includes("tree-removal") ||
    KW.landscape.test(text)
  ) {
    return "landscaping";
  }
  return "generic";
}

/** CPL simulation (higher = fewer leads per $). */
const CPL = {
  facebook: 19,
  instagram: 24,
  google: 31,
};

function areaDensityFactor(serviceArea) {
  const a = norm(serviceArea);
  if (!a) return 1;
  const h = hashStr(a);
  const metro = /\b(madrid|barcelona|ciudad|capital|metro|área|area|zona norte|sur)\b/i.test(a);
  if (metro) return 1.08 + (h % 7) / 100;
  if (a.length > 45) return 1.02 + (h % 5) / 100;
  return 0.92 + (h % 9) / 100;
}

function jitter(seed, i, min = 0.94, max = 1.08) {
  const x = hashStr(`${seed}-${i}`);
  return min + ((x % 1000) / 1000) * (max - min);
}

function formatUsd(n) {
  const v = Math.round(Number(n) || 0);
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function shortArea(area) {
  const a = norm(area);
  if (!a) return "tu zona de servicio";
  return a.length > 72 ? `${a.slice(0, 69)}…` : a;
}

function servicePhrase(services, otherDetail) {
  const svc = Array.isArray(services) ? services : [];
  const labels = svc
    .filter((s) => s !== "other")
    .map((s) => SERVICE_LABELS[s] || s);
  if (svc.includes("other") && norm(otherDetail)) labels.push(otherDetail.trim());
  if (labels.length === 0) return "servicios locales";
  if (labels.length === 1) return labels[0].toLowerCase();
  return `${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}`.toLowerCase();
}

/**
 * @param {string} vertical
 * @param {{ businessName?: string, businessDescription?: string, serviceArea?: string, services?: string[], serviceOtherDetail?: string }} data
 */
function buildThreeCampaigns(vertical, data) {
  const name = norm(data.businessName) || "Tu negocio";
  const area = shortArea(data.serviceArea);
  const svcLine = servicePhrase(data.services, data.serviceOtherDetail);
  const seed = `${name}|${vertical}|${svcLine}`;

  /** @type {{ platform: 'facebook'|'instagram'|'google', kind: string, title: string, audience: (ctx: object) => string, copy: (ctx: object) => string }[]} */
  const recipes = {
    landscaping: [
      {
        platform: "facebook",
        kind: "awareness",
        title: `Temporada y confianza · ${name}`,
        audience: (c) =>
          `Propietarios 35–60 años cerca de ${c.area}; intereses hogar, jardín y mejoras exteriores.`,
        copy: (c) =>
          `Impulsa solicitudes de presupuesto para ${c.svcLine}: visita sin compromiso, plan claro y calendario de trabajo. Enfocado en vecindarios que ya contratan mantenimiento.`,
      },
      {
        platform: "google",
        kind: "local",
        title: `Búsqueda local · ${svcLine}`,
        audience: (c) =>
          `Intención alta en Google: búsquedas tipo «paisajismo cerca» y «${c.area.split(",")[0]}» con radio ajustado.`,
        copy: (c) =>
          `Campaña tipo Google Local / búsqueda con extensiones de llamada y ubicación: «${c.name} — respuesta en 24 h».`,
      },
      {
        platform: "instagram",
        kind: "visual",
        title: `Antes / después · proyectos reales`,
        audience: (c) =>
          `Hogares y comunidades; intereses DIY, sostenibilidad y exterior; remarketing a visitas al perfil.`,
        copy: (c) =>
          `Carrusel con resultados visuales de ${c.svcLine}; CTA a WhatsApp o formulario breve.`,
      },
    ],
    cleaning: [
      {
        platform: "facebook",
        kind: "trust",
        title: `Reseñas y recurrencia · ${name}`,
        audience: (c) =>
          `Familias y profesionales en ${c.area}; intereses hogar, organización y tiempo libre.`,
        copy: (c) =>
          `Anuncio de valor: primera visita con checklist y garantía de satisfacción para servicios de ${c.svcLine}.`,
      },
      {
        platform: "google",
        kind: "search",
        title: `Google Search · intención inmediata`,
        audience: (c) =>
          `Keywords de alta intención: «${c.svcLine}», «limpieza a domicilio» + ubicación.`,
        copy: (c) =>
          `Anuncios de búsqueda con extensiones de llamada y formulario: captura leads que buscan ya.`,
      },
      {
        platform: "facebook",
        kind: "retarget",
        title: `Remarketing · visitantes web`,
        audience: (c) =>
          `Personas que visitaron tu web o interactuaron con anuncios en los últimos 30 días.`,
        copy: (c) =>
          `Secuencia de creatividades con prueba social y oferta limitada para cerrar ${c.svcLine}.`,
      },
    ],
    pressure_washing: [
      {
        platform: "facebook",
        kind: "offer",
        title: `Oferta de temporada · fachadas y terrazas`,
        audience: (c) =>
          `Vecinos en ${c.area}; intereses bricolaje, hogar y mantenimiento exterior.`,
        copy: (c) =>
          `Creatividades antes/después para ${c.svcLine}; CTA claro a presupuesto rápido por foto.`,
      },
      {
        platform: "instagram",
        kind: "visual",
        title: `Reels / carrusel · resultado visible`,
        audience: (c) =>
          `Propietarios 25–55 años; intereses exterior, hogar y estética; remarketing local.`,
        copy: (c) =>
          `Vídeo corto de alta presión en acción; texto con zona cubierta y tiempo de respuesta.`,
      },
      {
        platform: "google",
        kind: "local",
        title: `Google · búsqueda local`,
        audience: (c) =>
          `Consultas locales «hidrolimpieza», «limpieza fachada» con exclusión fuera de ${c.area}.`,
        copy: (c) =>
          `Anuncios locales alineados con ${c.svcLine}; extensión de ubicación y llamada.`,
      },
    ],
    roofing: [
      {
        platform: "google",
        kind: "search",
        title: `Emergencias y reforma de cubierta`,
        audience: (c) =>
          `Alta intención: filtraciones, tejas, impermeabilización; radio según ${c.area}.`,
        copy: (c) =>
          `Search con anuncios orientados a urgencia y presupuesto; extensiones de llamada para ${c.name}.`,
      },
      {
        platform: "facebook",
        kind: "retarget",
        title: `Remarketing · visitantes y engagement`,
        audience: (c) =>
          `Audiencias custom de web, vídeo y lista de clientes; lookalike en zona.`,
        copy: (c) =>
          `Creatividades de confianza: garantías, obras recientes y CTA a inspección gratuita.`,
      },
      {
        platform: "instagram",
        kind: "proof",
        title: `Prueba social · obra en curso`,
        audience: (c) =>
          `Propietarios en ${c.area}; intereses construcción, reformas y climatología.`,
        copy: (c) =>
          `Historias y reels de obra real para ${c.svcLine}; refuerzo de marca local.`,
      },
    ],
    generic: [
      {
        platform: "facebook",
        kind: "lead",
        title: `Captación local · ${name}`,
        audience: (c) =>
          `Vecinos y pymes en ${c.area}; intereses relacionados con ${c.svcLine}.`,
        copy: (c) =>
          `Mensaje claro de propuesta de valor y llamada a la acción para solicitar información.`,
      },
      {
        platform: "google",
        kind: "search",
        title: `Búsqueda · demanda activa`,
        audience: (c) =>
          `Keywords locales acordes a ${c.svcLine} y ubicación.`,
        copy: (c) =>
          `Anuncios de búsqueda con extensiones y segmentación geográfica fina.`,
      },
      {
        platform: "instagram",
        kind: "brand",
        title: `Marca y contenido · ${name}`,
        audience: (c) =>
          `Audiencia amplia local refinada por engagement; intereses alineados a tu sector.`,
        copy: (c) =>
          `Contenido auténtico que muestra equipo, proceso y resultados para ${c.svcLine}.`,
      },
    ],
  };

  const list = recipes[vertical] || recipes.generic;
  const density = areaDensityFactor(data.serviceArea);

  return list.map((recipe, i) => {
    const ctx = {
      name,
      area,
      svcLine,
    };
    const budgetBase =
      vertical === "roofing" ? 380 : vertical === "cleaning" ? 290 : vertical === "pressure_washing" ? 310 : 340;
    const budget = Math.round(budgetBase * jitter(seed, i, 0.88, 1.12) * density);
    const cpl = CPL[recipe.platform] * jitter(seed, i + 9, 0.92, 1.1);
    const leads = Math.max(5, Math.round((budget / cpl) * density));

    return {
      id: `${vertical}-${recipe.platform}-${recipe.kind}`,
      name: recipe.title,
      budgetWeekly: budget,
      estimatedLeadsWeekly: leads,
      audience: recipe.audience(ctx),
      platform: recipe.platform,
      adDescription: recipe.copy(ctx),
    };
  });
}

/**
 * @param {Record<string, unknown>} businessData Firestore business document
 */
export function generateCampaignRecommendations(businessData) {
  const safe = businessData && typeof businessData === "object" ? businessData : {};
  const services = Array.isArray(safe.services) ? safe.services : [];
  const description = norm(safe.businessDescription);
  const businessName = norm(safe.businessName);
  const vertical = detectVertical(services, description, businessName);

  const built = buildThreeCampaigns(vertical, {
    businessName,
    businessDescription: description,
    serviceArea: norm(safe.serviceArea),
    services,
    serviceOtherDetail: norm(safe.serviceOtherDetail),
  });
  /** Una sola sugerencia orientativa hasta integrar IA real e historial. */
  const campaigns = built.slice(0, 1);

  const totalBudgetWeekly = campaigns.reduce((s, c) => s + c.budgetWeekly, 0);
  const estimatedLeadsWeekly = campaigns.reduce((s, c) => s + c.estimatedLeadsWeekly, 0);

  const leadByPlatform = {};
  campaigns.forEach((c) => {
    leadByPlatform[c.platform] = (leadByPlatform[c.platform] || 0) + c.estimatedLeadsWeekly;
  });
  const order = ["google", "facebook", "instagram"];
  let bestPlatform = "google";
  let bestLeads = -1;
  order.forEach((p) => {
    const v = leadByPlatform[p] || 0;
    if (v > bestLeads) {
      bestLeads = v;
      bestPlatform = p;
    }
  });

  const platformLabel = {
    facebook: "Facebook",
    instagram: "Instagram",
    google: "Google",
  };

  const bestPlatformTrend = {
    facebook: "Alcance y confianza en comunidad local",
    instagram: "Contenido visual y engagement",
    google: "Mayor intención de compra en búsqueda",
  };

  return {
    vertical,
    summary: {
      campaignsSuggested: campaigns.length,
      totalBudgetWeekly,
      estimatedLeadsWeekly,
      bestPlatformKey: bestPlatform,
      bestPlatformLabel: platformLabel[bestPlatform],
      bestPlatformTrend: bestPlatformTrend[bestPlatform],
    },
    campaigns: campaigns.map((c) => ({
      ...c,
      platformLabel: platformLabel[c.platform],
    })),
  };
}

export { formatUsd };

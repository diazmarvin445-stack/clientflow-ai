/**
 * Mock “AI” campaign generation from owner inputs (no OpenAI — replace later).
 */

const CPL = { facebook: 19, instagram: 24, google: 31 };

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

function parseBudgetWeekly(raw) {
  const s = String(raw || "").replace(/[^\d.]/g, "");
  const n = parseFloat(s);
  if (Number.isFinite(n) && n > 0) return Math.min(Math.max(Math.round(n), 50), 5000);
  return 320;
}

function pickPlatform(pref, seed) {
  const p = norm(pref).toLowerCase();
  if (p === "facebook") return "facebook";
  if (p === "instagram") return "instagram";
  if (p === "google") return "google";
  const h = hashStr(seed) % 3;
  return h === 0 ? "facebook" : h === 1 ? "instagram" : "google";
}

/**
 * @param {{
 *   goal: string,
 *   offer: string,
 *   location: string,
 *   budget: string,
 *   audience: string,
 *   platformPref: string,
 * }} inputs
 * @param {string} businessName
 */
export function mockGenerateCampaignFromInputs(inputs, businessName) {
  const name = norm(businessName) || "Tu negocio";
  const goal = norm(inputs.goal) || "atraer clientes de tu zona";
  const offer = norm(inputs.offer) || "consulta sin compromiso";
  const location = norm(inputs.location) || "tu área de servicio";
  const audience = norm(inputs.audience) || "hogares y negocios cercanos";
  const budgetWeekly = parseBudgetWeekly(inputs.budget);
  const seed = `${name}|${goal}|${offer}|${location}|${audience}`;
  const platform = pickPlatform(inputs.platformPref, seed);
  const cpl = CPL[platform] * (0.94 + (hashStr(seed + "cpl") % 14) / 100);
  const estimatedLeadsWeekly = Math.max(4, Math.round(budgetWeekly / cpl));

  const h = hashStr(seed);
  const hooks = [
    `${name}: ${offer} — ahora en ${location}`,
    `¿Buscas ${goal.split(",")[0].slice(0, 40)}? ${name} te ayuda`,
    `Oferta en ${location}: ${offer}`,
  ];
  const hook = hooks[h % hooks.length];

  const headlines = [
    `${name} · ${offer}`,
    `Tu próximo proyecto empieza aquí — ${name}`,
    `${goal.slice(0, 48)}${goal.length > 48 ? "…" : ""} con ${name}`,
  ];
  const headline = headlines[(h + 1) % headlines.length];

  const bodyText =
    `En ${location} ayudamos a ${audience} a lograr: ${goal}. ` +
    `Incluye: ${offer}. Mensaje claro, prueba social y llamada a la acción directa para generar solicitudes cualificadas. ` +
    `Ton profesional y cercano, adaptado a negocio local.`;

  const ctas = [
    "Solicita tu presupuesto gratis",
    "Reserva tu visita hoy",
    "Escríbenos por WhatsApp",
    "Pide cita en segundos",
  ];
  const cta = ctas[h % ctas.length];

  const creatives = [
    "Carrusel antes/después + testimonio corto en voz del cliente.",
    "Vídeo vertical 15s: llegada al lugar + resultado final + CTA.",
    "Foto de equipo con uniforme + texto overlay con la oferta.",
    "Reels con tip rápido + sticker de ubicación en " + location.slice(0, 24),
  ];
  const creativeIdea = creatives[h % creatives.length];

  return {
    headline,
    hook,
    bodyText,
    cta,
    platform,
    suggestedBudgetWeekly: budgetWeekly,
    estimatedLeadsWeekly,
    creativeIdea,
  };
}

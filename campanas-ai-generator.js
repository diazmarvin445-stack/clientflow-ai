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

function shortPhrase(s, max) {
  const t = norm(s);
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max).trim()}…`;
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
  const goal = norm(inputs.goal) || "atraer clientes cualificados en tu zona";
  const offer = norm(inputs.offer) || "diagnóstico o primera visita sin compromiso";
  const location = norm(inputs.location) || "tu zona de servicio";
  const audience = norm(inputs.audience) || "hogares y negocios de la zona";
  const budgetWeekly = parseBudgetWeekly(inputs.budget);
  const seed = `${name}|${goal}|${offer}|${location}|${audience}`;
  const platform = pickPlatform(inputs.platformPref, seed);
  const cpl = CPL[platform] * (0.94 + (hashStr(seed + "cpl") % 14) / 100);
  const estimatedLeadsWeekly = Math.max(4, Math.round(budgetWeekly / cpl));

  const h = hashStr(seed);
  const goalShort = shortPhrase(goal, 52);
  const offerShort = shortPhrase(offer, 44);
  const locShort = shortPhrase(location, 36);

  const hooks = [
    `${locShort}: ${offerShort} con ${name}. Respuesta en el mismo día.`,
    `¿${goalShort}? En ${locShort} ya confían en ${name} — ${offerShort}.`,
    `Parar de perder tiempo: ${offerShort} en ${locShort}. Pide cita con ${name}.`,
    `${name} en ${locShort}: ${offerShort}. Anuncio pensado para ${audience.split(",")[0].slice(0, 42)}.`,
    `Tu próximo paso hacia «${goalShort}»: ${name}, ${offerShort}.`,
    `Oferta clara para ${audience.split(" ")[0] || "tu público"}: ${offerShort} · ${locShort}.`,
  ];
  const hook = hooks[h % hooks.length];

  const headlines = [
    `${name} · ${offerShort}`,
    `${goalShort} — ${name} (${locShort})`,
    `En ${locShort}, ${name} te acerca a: ${goalShort}`,
    `${name}: resultados medibles para ${audience.split(",")[0].slice(0, 32) || "tu mercado"}`,
    `Impulsa ${goalShort} con ${name}`,
    `La propuesta que tu competencia no copia — ${name}`,
  ];
  const headline = headlines[(h + 3) % headlines.length];

  const proofBits = [
    "Incluye prueba social (reseñas o casos) y un beneficio medible en la primera línea.",
    "Abre con el dolor concreto y cierra con un siguiente paso fácil (cita, llamada o WhatsApp).",
    "Menciona cercanía y tiempos de respuesta: en servicios locales eso convierte.",
  ];
  const proof = proofBits[h % proofBits.length];

  const bodyText = [
    `Si tu objetivo es ${goalShort.toLowerCase()}, este anuncio habla directamente a ${audience} en ${locShort}. `,
    `Destacamos ${offerShort.toLowerCase()} y dejamos claro qué pasa después de contactar: sin letras pequeñas ni promesas vacías. `,
    `${proof} `,
    `Copia en tono profesional y cercano, lista para subir a ${platform === "google" ? "Google Ads" : platform === "instagram" ? "Instagram" : "Facebook"} y empezar a captar solicitudes esta misma semana.`,
  ].join("");

  const ctas = [
    "Reserva tu cita en 1 clic",
    "Pide presupuesto sin compromiso",
    "Habla con nosotros por WhatsApp",
    "Agenda diagnóstico gratuito",
    "Solicita visita esta semana",
    "Cuéntanos tu caso — respondemos hoy",
  ];
  const cta = ctas[h % ctas.length];

  const creatives = [
    `Carrusel 4–5 slides: problema → proceso con ${name} → resultado → testimonio corto → CTA «${cta}».`,
    `Vídeo vertical 12–18 s: plano del barrio (${locShort}) + plano del equipo + texto con la oferta y sticker de ubicación.`,
    `Foto real de trabajo terminado + overlay con ${offerShort}; subtítulos con palabras clave locales.`,
    `Reels: tip rápido relacionado con «${goalShort}» + corte a ${name} presentando la oferta + botón de contacto.`,
    `Imagen limpia con logo + headline del anuncio + badge «${locShort}» para refuerzo geográfico.`,
    `Story serie 3: pregunta al público → mini caso → swipe up / enlace con «${cta}».`,
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

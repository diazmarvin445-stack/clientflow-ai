/**
 * Mock “AI” campaign generation from owner inputs (no OpenAI — replace later).
 * Output is composed from objectives, offer, audience, location, and budget so it
 * feels responsive rather than rotating fixed templates.
 */

const CPL = { facebook: 19, instagram: 24, google: 31 };

/** @typedef {'booking'|'calls'|'traffic'|'leads'} CampaignIntent */
/** @typedef {'young'|'b2b'|'local'|'general'} AudienceSegment */

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
 * Raw user budget: digits and decimal separator only.
 * @returns {{ value: number, userProvided: boolean }}
 */
function parseBudgetInput(raw) {
  const rawStr = String(raw ?? "").trim();
  if (!rawStr) {
    return { value: 320, userProvided: false };
  }
  const cleaned = rawStr.replace(/[^\d.]/g, "");
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n) || n <= 0) {
    return { value: 320, userProvided: false };
  }
  const clamped = Math.min(Math.max(Math.round(n), 50), 5000);
  return { value: clamped, userProvided: true };
}

/**
 * When the user typed a budget, keep it close (small deterministic nudge).
 * When empty, use a seed-based default in a believable SMB range.
 */
function resolveWeeklyBudget(raw, seed) {
  const { value, userProvided } = parseBudgetInput(raw);
  if (!userProvided) {
    const spread = hashStr(`${seed}|budget`) % 140;
    return Math.round(260 + spread);
  }
  const nudge = 0.94 + (hashStr(`${seed}|budge`) % 13) / 100;
  return Math.min(5000, Math.max(50, Math.round(value * nudge)));
}

function shortPhrase(s, max) {
  const t = norm(s);
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max).trim()}…`;
}

/**
 * @param {string} blob
 * @returns {CampaignIntent}
 */
function inferCampaignIntent(blob) {
  const t = norm(blob).toLowerCase();
  const score = {
    booking: 0,
    calls: 0,
    traffic: 0,
    leads: 0,
  };

  const bump = (key, re) => {
    if (re.test(t)) score[key] += 2;
  };

  bump(
    "booking",
    /\b(reserv|cita[s]?|agenda[r]?|agendar|appointment|book(ing)?|calendario|visita\s+program|pedir\s+cita)\b/i,
  );
  bump("calls", /\b(llam[aá]r?|ll[aá]manos|tel[ée]fono|tel\.|telefono|call[s]?|whatsapp)\b/i);
  bump(
    "traffic",
    /\b(tr[aá]fico|trafico|web|sitio|p[aá]gina|visitas?\s+a|brand(ing)?|marca|alcance|awareness|reconocimiento)\b/i,
  );
  bump(
    "leads",
    /\b(lead[s]?|informaci[oó]n|info|presupuesto|formulario|cotiz|solicitud|captaci[oó]n|consulta)\b/i,
  );

  if (/\b(ll[eé]name|tel[eé]fono|llamad)\b/i.test(t)) score.calls += 1;
  if (/\b(reserv|agenda)\b/i.test(t)) score.booking += 1;

  /** @type {(keyof typeof score)[]} */
  const order = ["booking", "calls", "traffic", "leads"];
  const maxScore = Math.max(score.booking, score.calls, score.traffic, score.leads);

  if (maxScore <= 0) {
    if (/\b(visita|agenda|cita|reserv)\b/i.test(t)) return "booking";
    if (/\b(llam|tel|whatsapp)\b/i.test(t)) return "calls";
    if (/\b(web|sitio|tr[aá]fico|trafico)\b/i.test(t)) return "traffic";
    return "leads";
  }

  let best = /** @type {CampaignIntent} */ ("leads");
  let max = -1;
  order.forEach((k) => {
    if (score[k] > max) {
      max = score[k];
      best = k;
    }
  });
  return best;
}

/**
 * @param {string} goal
 * @param {string} audience
 * @param {string} offer
 * @param {string} location
 * @returns {AudienceSegment}
 */
function detectSegment(goal, audience, offer, location) {
  const blob = `${goal} ${audience} ${offer} ${location}`.toLowerCase();

  const young =
    /\b(gen\s*z|generaci[oó]n\s*z|millennial|zoomer|tiktok|reels|stories|instagram|jóven|jovenes|univ|universidad|estudiant|\b18\b|\b20\b|\b25\b|\b30\b)\b/i.test(
      blob,
    ) || /\b\d{1,2}\s*[-–]\s*\d{1,2}\s*años\b/i.test(blob);

  const b2b =
    /\b(b2b|empresa[s]?|industrial|oficina[s]?|proveedor|saas|corporat|negocio[s]?\s+b2b|profesional|consultor)\b/i.test(
      blob,
    );

  const localHome =
    /\b(hogar|domicilio|a\s+domicilio|local|vecind|barrio|casa|reparaci|limpieza|fontan|jard[ií]n|climatizaci|obr(a|as)\s+en)\b/i.test(
      blob,
    );

  if (young && !b2b) return "young";
  if (b2b) return "b2b";
  if (localHome) return "local";
  return "general";
}

/**
 * @param {string} pref
 * @param {AudienceSegment} segment
 * @param {string} seed
 */
function pickPlatformAuto(pref, segment, seed) {
  const p = norm(pref).toLowerCase();
  if (p === "facebook" || p === "instagram" || p === "google") {
    return { platform: p, styleNote: "" };
  }

  const h = hashStr(`${seed}|plat`) % 100;

  if (segment === "young") {
    if (h < 74) {
      return {
        platform: "instagram",
        styleNote: "Contenido corto (Reels / estilo TikTok)",
      };
    }
    return { platform: "facebook", styleNote: "" };
  }

  if (segment === "b2b") {
    if (h < 58) return { platform: "google", styleNote: "Búsqueda con intención" };
    return { platform: "facebook", styleNote: "" };
  }

  if (segment === "local") {
    if (h < 50) return { platform: "facebook", styleNote: "Alcance en comunidad local" };
    if (h < 90) return { platform: "instagram", styleNote: "Creatividad visual cercana" };
    return { platform: "google", styleNote: "Búsqueda local / servicios" };
  }

  if (h < 40) return { platform: "facebook", styleNote: "" };
  if (h < 75) return { platform: "instagram", styleNote: "" };
  return { platform: "google", styleNote: "" };
}

/**
 * @param {CampaignIntent} intent
 */
function ctaForIntent(intent) {
  switch (intent) {
    case "booking":
      return "Reserva hoy";
    case "calls":
      return "Llámanos ahora";
    case "traffic":
      return "Conoce más";
    default:
      return "Solicita información";
  }
}

const PLATFORM_LABEL = {
  facebook: "Facebook",
  instagram: "Instagram",
  google: "Google Ads",
};

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
 * @param {number} [variationSalt] Increment on each generate/regenerate to rotate phrasing with the same inputs.
 */
export function mockGenerateCampaignFromInputs(inputs, businessName, variationSalt = 0) {
  const name = norm(businessName) || "Tu negocio";
  const goalRaw = norm(inputs.goal);
  const offerRaw = norm(inputs.offer);
  const locationRaw = norm(inputs.location);
  const audienceRaw = norm(inputs.audience);

  const goal = goalRaw || "conseguir más solicitudes cualificadas";
  const offer = offerRaw || "una propuesta clara y sin letras pequeñas";
  const location = locationRaw || "tu zona de actuación";
  const audience = audienceRaw || "clientes potenciales en la zona";

  const intentBlob = `${goalRaw} ${audienceRaw} ${offerRaw}`;
  const intent = inferCampaignIntent(intentBlob);
  const segment = detectSegment(goalRaw, audienceRaw, offerRaw, locationRaw);

  /** Metrics & channel stay stable for the same form; copy rotates with `variationSalt`. */
  const stableSeed = `${name}|${goal}|${offer}|${location}|${audience}|${intent}|${segment}`;
  const seed = `${stableSeed}|v${variationSalt}`;

  const budgetWeekly = resolveWeeklyBudget(inputs.budget, stableSeed);

  const { platform, styleNote } = pickPlatformAuto(inputs.platformPref, segment, stableSeed);
  const cpl = CPL[platform] * (0.94 + (hashStr(`${stableSeed}|cpl`) % 14) / 100);
  const estimatedLeadsWeekly = Math.max(4, Math.round(budgetWeekly / cpl));

  const cta = ctaForIntent(intent);

  const g = shortPhrase(goal, 56);
  const o = shortPhrase(offer, 48);
  const l = shortPhrase(location, 40);
  const a = shortPhrase(audience, 48);

  const hi = hashStr(`${seed}|head`);
  const connectors = ["·", "—", "|"];
  const conn = connectors[hi % connectors.length];

  /** @type {() => string[]} */
  const headlinePickers = [
    () => [`${name} ${conn} ${g}`, l ? ` (${l})` : ""].join(""),
    () => (l ? `${o} · ${name} en ${l}` : `${o} · ${name}`),
    () => `${g.charAt(0).toUpperCase() + g.slice(1)} — ${name}`,
    () => `Para ${a}: ${name} y ${g.toLowerCase()}`,
    () => (l ? `${name} en ${l}: ${g}` : `${name}: ${g}`),
    () => `${name}: ${o}`,
    () => `${g} ${conn} ${name}${l ? ` · ${l}` : ""}`,
  ];
  const headline = headlinePickers[hi % headlinePickers.length]();

  const hookIdx = hashStr(`${seed}|hook`);
  /** @type {() => string} */
  const hookPickers = [
    () =>
      l
        ? `En ${l}, ${a} suele buscar exactamente esto: ${g.toLowerCase()}. Con ${name}, ${o.toLowerCase()} queda explicado en el primer pantallazo.`
        : `${a} valora claridad: ${g.toLowerCase()}. ${name} presenta ${o.toLowerCase()} sin rodeos.`,
    () =>
      `Tu prioridad (${g.toLowerCase()}) se traduce en un mensaje que nombra a ${a} y ancla la oferta: ${o.toLowerCase()}${l ? `, con foco en ${l}.` : "."}`,
    () =>
      l
        ? `${l}: ${o} con ${name}. Pensado para ${a} — alineado con «${g.toLowerCase()}».`
        : `${o} con ${name}, hablando directamente con ${a} sobre ${g.toLowerCase()}.`,
    () =>
      `Si el objetivo es ${g.toLowerCase()}, el gancho es simple: ${o.toLowerCase()} para ${a}${l ? ` en ${l}` : ""}, con ${name} como respuesta rápida.`,
    () =>
      `${a}: cuando la decisión pasa por ${g.toLowerCase()}, ${name} refuerza confianza con ${o.toLowerCase()}${l ? ` y referencia local (${l}).` : "."}`,
  ];
  const hook = hookPickers[hookIdx % hookPickers.length]();

  const platLabel = PLATFORM_LABEL[platform];
  const intentNarrative = {
    booking:
      "El anuncio debe pedir un siguiente paso concreto en el calendario: fricción mínima y horarios visibles.",
    calls:
      "Prioriza el canal telefónico o WhatsApp: número claro, horario de respuesta y motivo para llamar ya.",
    traffic:
      "Refuerza curiosidad y marca: beneficio en titular y un destino útil (web o landing) sin pedir compromiso fuerte al primer toque.",
    leads:
      "Formulario o chat corto: pide solo lo indispensable y promete respuesta rápida para subir conversión.",
  }[intent];

  const segmentNarrative = {
    young:
      "Ritmo rápido, primer plano humano y texto corto; prueba variaciones de 6–10 palabras para el hook.",
    b2b:
      "Tono serio y prueba de credibilidad: casos, plazos y diferencial frente a alternativas genéricas.",
    local:
      "Geolocalización y prueba social local (reseñas, barrio, tiempo de llegada) para reducir fricción.",
    general:
      "Combina beneficio tangible + prueba ligera (dato, mini caso o garantía) antes del CTA.",
  }[segment];

  const bodyLead = (() => {
    const openers = [
      () =>
        `Objetivo declarado: ${g.toLowerCase()}. Hablamos a ${a} en ${locationRaw ? l : "tu mercado"} partiendo de ${o.toLowerCase()}.`,
      () =>
        `Pensado para ${a}${l ? ` en ${l}` : ""}: el mensaje arranca con «${g.toLowerCase()}» y cierra con la oferta (${o.toLowerCase()}).`,
      () =>
        `Pieza alineada con ${g.toLowerCase()}: ${name} comunica ${o.toLowerCase()} sin perder el contexto de ${a}${l ? ` (${l})` : ""}.`,
    ];
    return openers[hashStr(`${seed}|body0`) % openers.length]();
  })();

  const bodyMid = (() => {
    const mids = [
      () =>
        `${intentNarrative} ${segmentNarrative} El CTA sugerido («${cta}») encaja con ese objetivo.`,
      () =>
        `Recomendación de copy: una sola promesa por anuncio, refrendada con ${o.toLowerCase()} y un recordatorio de para quién es (${a}).`,
    ];
    return mids[hashStr(`${seed}|body1`) % mids.length]();
  })();

  const bodyClose = `Canal sugerido: ${platLabel}. Redactado para rendir en ${
    platform === "google"
      ? "anuncios de búsqueda con intención y extensiones de llamada o ubicación"
      : platform === "instagram"
        ? "formato vertical, texto breve y prueba visual inmediata"
        : "feed o ventana de mensajes con prueba social y oferta explícita"
  }.`;

  const bodyText = [bodyLead, " ", bodyMid, " ", bodyClose].join("").replace(/\s+/g, " ").trim();

  const platformDisplayLabel = styleNote ? `${platLabel} · ${styleNote}` : platLabel;

  const creativeIdeas = (() => {
    const base = hashStr(`${seed}|cr`) % 4;
    if (platform === "google") {
      return [
        `Anuncio RSA: 12–15 titulares que mezclen ${g.toLowerCase()}, ${l || "tu zona"} y ${o.toLowerCase()}; descripciones con prueba y CTA «${cta}».`,
        `Grupo de anuncios por intención: keywords locales + anuncio con ${o.toLowerCase()} y extensión de llamada para ${a}.`,
        `Anuncio de búsqueda: dolor (${g.toLowerCase()}) → solución (${name}) → siguiente paso (${cta}).`,
        `Prueba A/B: titular con ${l || "ubicación"} vs titular con ${o.toLowerCase()}; mide CTR hacia ${cta}.`,
      ][base];
    }
    if (platform === "instagram") {
      return [
        `Reels 15–22 s: hook con ${g.toLowerCase()}, plano de ${name}, texto con ${o.toLowerCase()} y sticker de ubicación${l ? ` (${l})` : ""}. Estilo dinámico tipo TikTok.`,
        `Carrusel: problema para ${a} → cómo ${name} lo resuelve → oferta (${o.toLowerCase()}) → prueba → «${cta}».`,
        `Historia 3 pasos: encuesta rápida a ${a} → mini prueba → enlace con «${cta}».`,
        `Foto real + copy breve: titular con ${g.toLowerCase()}, subtítulo con ${o.toLowerCase()} y CTA «${cta}».`,
      ][base];
    }
    return [
      `Vídeo corto en feed: vecindario (${l || "zona"}) + testimonio de 1 frase + ${o.toLowerCase()} + botón «${cta}».`,
      `Carrusel 4 diapositivas: antes/después o proceso → ${name} → oferta (${o.toLowerCase()}) → ${cta}.`,
      `Creatividad estática: headline del anuncio + badge de ${l || "zona"} + prueba social y «${cta}».`,
      `Secuencia de remarketing: recordatorio de ${g.toLowerCase()} con ${o.toLowerCase()} y CTA «${cta}».`,
    ][base];
  })();

  return {
    headline,
    hook,
    bodyText,
    cta,
    platform,
    platformDisplayLabel,
    suggestedBudgetWeekly: budgetWeekly,
    estimatedLeadsWeekly,
    creativeIdea: creativeIdeas,
  };
}

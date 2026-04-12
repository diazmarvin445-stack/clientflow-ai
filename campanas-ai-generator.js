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
 * @param {{ value: number, userProvided: boolean }} parsed
 */
function resolveWeeklyBudgetFromParsed(parsed, seed) {
  if (!parsed.userProvided) {
    const spread = hashStr(`${seed}|budget`) % 140;
    return Math.round(260 + spread);
  }
  const nudge = 0.94 + (hashStr(`${seed}|budge`) % 13) / 100;
  return Math.min(5000, Math.max(50, Math.round(parsed.value * nudge)));
}

function shortPhrase(s, max) {
  const t = norm(s);
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max).trim()}…`;
}

/** Formato monetario legible en prosa (USD). */
function formatUsdMoney(n) {
  const v = Math.round(Number(n) || 0);
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** Cómo se interpretó el selector de plataforma en el formulario. */
function describePlatformPref(pref) {
  const x = norm(pref).toLowerCase();
  if (x === "facebook") return "Facebook — elegido manualmente";
  if (x === "instagram") return "Instagram — elegido manualmente";
  if (x === "google") return "Google Ads — elegido manualmente";
  return "Automática — el motor asigna canal según audiencia, ubicación y tipo de servicio";
}

/**
 * Párrafo inicial que repite las entradas del usuario; si cambia un campo, este bloque cambia de forma evidente.
 */
function buildInputEchoParagraph(inputs, budgetWeekly, platformDisplayLabel, budgetParsed) {
  const chunks = [];
  const g = norm(inputs.goal);
  const o = norm(inputs.offer);
  const loc = norm(inputs.location);
  const aud = norm(inputs.audience);
  if (g) chunks.push(`Objetivo: «${g}».`);
  if (o) chunks.push(`Promoción u oferta: «${o}».`);
  if (loc) chunks.push(`Ubicación objetivo: «${loc}».`);
  if (aud) chunks.push(`Audiencia: «${aud}».`);
  if (budgetParsed.userProvided) {
    chunks.push(
      `Presupuesto: escribiste ${formatUsdMoney(budgetParsed.value)}/semana; la simulación calibra ~${formatUsdMoney(budgetWeekly)}/semana para estimar alcance y leads.`,
    );
  } else {
    chunks.push(
      `Presupuesto: sin cifra en el formulario — asumimos ~${formatUsdMoney(budgetWeekly)}/semana para los números inferiores (añade un importe para anclar la sugerencia).`,
    );
  }
  chunks.push(
    `Plataforma en el formulario: ${describePlatformPref(inputs.platformPref)}. Salida operativa sugerida: ${platformDisplayLabel}.`,
  );
  return chunks.join(" ");
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

  const budgetParsed = parseBudgetInput(inputs.budget);
  /** Incluye presupuesto y selector de plataforma para que métricas y texto reaccionen a esos campos. */
  const stableSeed = `${name}|${goal}|${offer}|${location}|${audience}|${intent}|${segment}|${budgetParsed.userProvided ? `b${budgetParsed.value}` : "nobudget"}|p${norm(inputs.platformPref)}`;
  const seed = `${stableSeed}|v${variationSalt}`;

  const budgetWeekly = resolveWeeklyBudgetFromParsed(budgetParsed, stableSeed);

  const { platform, styleNote } = pickPlatformAuto(inputs.platformPref, segment, stableSeed);
  const cpl = CPL[platform] * (0.94 + (hashStr(`${stableSeed}|cpl`) % 14) / 100);
  const estimatedLeadsWeekly = Math.max(4, Math.round(budgetWeekly / cpl));

  const cta = ctaForIntent(intent);
  const platLabel = PLATFORM_LABEL[platform];

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
    () => `${platLabel}: ${g} — ${name}`,
    () => (l ? `${name} · ${platLabel} · ${g} (${l})` : `${name} · ${platLabel} · ${g}`),
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
    () =>
      budgetParsed.userProvided
        ? `Presupuesto de partida ${formatUsdMoney(budgetParsed.value)}/semana → simulamos con ~${formatUsdMoney(budgetWeekly)}/semana en ${platLabel}: ${o} para ${a}${l ? ` en ${l}` : ""}, ligado a ${g.toLowerCase()}.`
        : `Sin cifra de presupuesto en el formulario, usamos ~${formatUsdMoney(budgetWeekly)}/semana como supuesto en ${platLabel}; cuando indiques un importe, este párrafo y los números se anclan a tu dato.`,
    () =>
      `Canal ${platLabel}: el mensaje conecta «${g}» con «${o}»${l ? ` y geolocaliza en ${l}` : ""} para ${a}.`,
  ];
  const hook = hookPickers[hookIdx % hookPickers.length]();

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

  let platformDisplayLabel = styleNote ? `${platLabel} · ${styleNote}` : platLabel;
  const prefManual = ["facebook", "instagram", "google"].includes(norm(inputs.platformPref).toLowerCase());
  if (prefManual) {
    platformDisplayLabel = styleNote
      ? `${platLabel} · ${styleNote} · canal del formulario`
      : `${platLabel} · canal del formulario`;
  }

  const inputEcho = buildInputEchoParagraph(inputs, budgetWeekly, platformDisplayLabel, budgetParsed);

  const bodyText = [inputEcho, " ", bodyLead, " ", bodyMid, " ", bodyClose].join("").replace(/\s+/g, " ").trim();

  const creativeIdeas = (() => {
    const base = hashStr(`${seed}|cr`) % 4;
    if (platform === "google") {
      return [
        `(${platLabel}) Anuncio RSA: titulares con ${g.toLowerCase()}, ${l || "tu zona"} y ${o.toLowerCase()}; CTA «${cta}» · ~${formatUsdMoney(budgetWeekly)}/sem.`,
        `(${platLabel}) Keywords + ${l || "zona"} + anuncio con ${o.toLowerCase()} y extensión de llamada para ${a}.`,
        `(${platLabel}) Intención: ${g.toLowerCase()} → ${name} → ${cta} (supuesto ${formatUsdMoney(budgetWeekly)}/sem).`,
        `(${platLabel}) A/B: titular ${l || "ubicación"} vs ${o.toLowerCase()}; CTR hacia «${cta}».`,
      ][base];
    }
    if (platform === "instagram") {
      return [
        `(${platLabel}) Reels: ${g.toLowerCase()} + ${o.toLowerCase()} + sticker${l ? ` ${l}` : ""} · ${a} · «${cta}».`,
        `(${platLabel}) Carrusel: ${a} → ${name} → ${o.toLowerCase()} → «${cta}».`,
        `(${platLabel}) Historias: ${g.toLowerCase()} + prueba + enlace «${cta}».`,
        `(${platLabel}) Post fijo: ${g.toLowerCase()} + ${o.toLowerCase()} + CTA «${cta}».`,
      ][base];
    }
    return [
      `(${platLabel}) Vídeo feed: ${l || "zona"} + ${o.toLowerCase()} + «${cta}» · ${a}.`,
      `(${platLabel}) Carrusel: ${g.toLowerCase()} → ${name} → ${o.toLowerCase()} → ${cta}.`,
      `(${platLabel}) Estática: badge ${l || "local"} + ${o.toLowerCase()} + ${cta}.`,
      `(${platLabel}) Remarketing: ${g.toLowerCase()} + ${o.toLowerCase()} + ${cta} (~${formatUsdMoney(budgetWeekly)}/sem).`,
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

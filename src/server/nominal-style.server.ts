// Erkennt typische Vollverb-/Verbalstil-Phrasen, die im Nominal-/Telegrammstil
// vermieden werden sollen. Liefert die Liste der gefundenen Verstöße zurück.
export function enforceNominalStyle(text: string): { violations: string[] } {
  const patterns: Array<{ re: RegExp; label: string }> = [
    { re: /\bdie\s+sonne\s+(scheint|scheinen)\b/i, label: "die Sonne scheint" },
    { re: /\bdie\s+sonne\s+zeigt\s+sich\b/i, label: "die Sonne zeigt sich" },
    { re: /\bziehen?\s+\w+\s+auf\b/i, label: "ziehen … auf" },
    { re: /\bwolken\s+ziehen\b/i, label: "Wolken ziehen" },
    { re: /\bes\s+regnet\b/i, label: "es regnet" },
    { re: /\bes\s+schneit\b/i, label: "es schneit" },
    { re: /\bes\s+gewittert\b/i, label: "es gewittert" },
    { re: /\bder\s+wind\s+weht\b/i, label: "der Wind weht" },
    { re: /\bwir\s+erwarten\b/i, label: "wir erwarten" },
    { re: /\bes\s+wird\s+\w+/i, label: "es wird …" },
    { re: /\bzeigt\s+sich\b/i, label: "zeigt sich" },
    { re: /\bpräsentiert\s+sich\b/i, label: "präsentiert sich" },
    { re: /\bgestaltet\s+sich\b/i, label: "gestaltet sich" },
    { re: /\btemperatur(en)?\s+(steigt|sinkt|fällt|fallen|steigen)\b/i, label: "Temperatur steigt/sinkt/fällt" },
    { re: /\bniederschlag\s+(fällt|fallen)\b/i, label: "Niederschlag fällt" },
    { re: /\bschneefallgrenze\s+(sinkt|steigt|fällt)\b/i, label: "Schneefallgrenze sinkt/steigt (statt sinkend/steigend)" },
    { re: /\bnullgradgrenze\s+(sinkt|steigt|fällt)\b/i, label: "Nullgradgrenze sinkt/steigt (statt sinkend/steigend)" },
    { re: /\b(es|der\s+himmel)\s+bleibt\b/i, label: "es/der Himmel bleibt" },
    { re: /\bkommt\s+\w+\s+auf\b/i, label: "kommt … auf" },
    { re: /\bsetzt\s+\w+\s+ein\b/i, label: "setzt … ein" },
    { re: /\bdas\s+wetter\s+(ist|wird|bleibt)\b/i, label: "das Wetter ist/wird/bleibt" },
  ];
  const violations: string[] = [];
  for (const { re, label } of patterns) {
    if (re.test(text)) violations.push(label);
  }
  return { violations };
}

// Erkennt Sonnen-Vokabular im Nacht-Kontext (z. B. "In der Nacht meist klar,
// teils sonnig"). Splittet den Text in Sätze/Halbsätze und prüft jedes Segment,
// das einen Nacht-Trigger enthält, auf verbotene Sonnen-Begriffe.
export function enforceNightSunConsistency(text: string): { violations: string[] } {
  const NIGHT_TRIGGER = /\b(in der nacht|nachts|nachthälfte|gegen mitternacht|nach sonnenuntergang|vor sonnenaufgang)\b/i;
  const SUN_TERMS = /\b(sonnig|heiter|freundlich|sonnenschein|aufhellungen?|sonnige lücken|wolkenlücken)\b/i;
  // An Satzende-Zeichen ODER " - " (Telegrammstil-Trenner) splitten.
  const segments = text.split(/[.!?]+|\s-\s/);
  const violations: string[] = [];
  for (const seg of segments) {
    if (NIGHT_TRIGGER.test(seg) && SUN_TERMS.test(seg)) {
      const m = seg.match(SUN_TERMS);
      violations.push(`"${(m?.[0] ?? "").toLowerCase()}" im Nacht-Kontext`);
    }
  }
  return { violations };
}

// Wrapper: ruft die übergebene Generator-Funktion, prüft Nominalstil + Nacht-Sonne-Konsistenz
// in einem kombinierten Retry (max. 1×) mit verschärftem User-Prompt.
export async function generateTextNominal(
  systemPrompt: string,
  userPrompt: string,
  generateFn: (sys: string, usr: string) => Promise<string>,
): Promise<string> {
  const first = await generateFn(systemPrompt, userPrompt);
  const nominal = enforceNominalStyle(first);
  const nightSun = enforceNightSunConsistency(first);
  // Retry erst ab >=2 Verstößen — einzelne Bagatellen lösen keinen zweiten (Credit-)Call mehr aus.
  if (nominal.violations.length < 2 && nightSun.violations.length < 1) return first;


  const hints: string[] = [];
  if (nominal.violations.length > 0) {
    console.log(`[nominal-style] Verstöße erkannt: ${nominal.violations.join(", ")} — Retry`);
    hints.push(
      `Im vorherigen Versuch wurden Vollverb-Phrasen verwendet (${nominal.violations.join(", ")}). ` +
      `Schreibe ZWINGEND im Nominal-/Telegrammstil — keine finiten Vollverben, sondern Substantiv-Phrasen. ` +
      `Beispiele: statt "die Sonne scheint" → "Sonnenschein"; statt "Wolken ziehen auf" → "Aufzug von Wolkenfeldern"; ` +
      `statt "es regnet" → "zeitweise Regen"; statt "Schneefallgrenze sinkt auf 900 m" → "Schneefallgrenze auf 900 m sinkend"; ` +
      `statt "Temperatur steigt auf 12 Grad" → "Höchsttemperatur 12 Grad".`
    );
  }
  if (nightSun.violations.length > 0) {
    console.log(`[night-sun] Verstöße erkannt: ${nightSun.violations.join(", ")} — Retry`);
    hints.push(
      `Im vorherigen Versuch wurde im Nacht-Kontext Sonnen-Vokabular verwendet (${nightSun.violations.join(", ")}). ` +
      `Schreibe ZWINGEND ohne "sonnig/teils sonnig/heiter/freundlich/Sonnenschein/Aufhellungen/sonnige Lücken/Wolkenlücken", ` +
      `sobald ein Satzteil die Nacht beschreibt ("in der Nacht", "nachts", "Nachthälfte", "nach Sonnenuntergang", "vor Sonnenaufgang"). ` +
      `Verwende stattdessen "klar", "meist klar", "sternenklar", "gering bewölkt", "wolkenlos", "aufgelockerte Bewölkung", "stark bewölkt", "bedeckt", "Nebel-/Hochnebelfelder". ` +
      `Beispiel: statt "In der Nacht meist klar, teils sonnig" → "In der Nacht meist klar, nur vereinzelt dünne Wolkenfelder".`
    );
  }
  const retryPrompt = userPrompt + "\n\nWICHTIG: " + hints.join("\n\n");

  try {
    const second = await generateFn(systemPrompt, retryPrompt);
    const reNominal = enforceNominalStyle(second);
    const reNight = enforceNightSunConsistency(second);
    if (reNominal.violations.length > 0) {
      console.warn(`[nominal-style] Auch Retry enthält Verstöße: ${reNominal.violations.join(", ")}`);
    }
    if (reNight.violations.length > 0) {
      console.warn(`[night-sun] Auch Retry enthält Verstöße: ${reNight.violations.join(", ")}`);
    }
    return second;
  } catch (e) {
    console.warn("[nominal-style] Retry fehlgeschlagen, behalte Erstversuch", e);
    return first;
  }
}

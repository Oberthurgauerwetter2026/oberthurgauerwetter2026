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

// Wrapper: ruft die übergebene Generator-Funktion, prüft Nominalstil,
// retried bei jedem Verstoß genau 1× mit verschärftem User-Prompt.
export async function generateTextNominal(
  systemPrompt: string,
  userPrompt: string,
  generateFn: (sys: string, usr: string) => Promise<string>,
): Promise<string> {
  const first = await generateFn(systemPrompt, userPrompt);
  const check = enforceNominalStyle(first);
  if (check.violations.length < 1) return first;
  console.log(`[nominal-style] Verstöße erkannt: ${check.violations.join(", ")} — Retry`);
  const retryPrompt = userPrompt +
    `\n\nWICHTIG: Im vorherigen Versuch wurden Vollverb-Phrasen verwendet (${check.violations.join(", ")}). ` +
    `Schreibe ZWINGEND im Nominal-/Telegrammstil — keine finiten Vollverben, sondern Substantiv-Phrasen. ` +
    `Beispiele: statt "die Sonne scheint" → "Sonnenschein"; statt "Wolken ziehen auf" → "Aufzug von Wolkenfeldern"; ` +
    `statt "es regnet" → "zeitweise Regen"; statt "Schneefallgrenze sinkt auf 900 m" → "Schneefallgrenze auf 900 m sinkend"; ` +
    `statt "Temperatur steigt auf 12 Grad" → "Höchsttemperatur 12 Grad".`;
  try {
    const second = await generateFn(systemPrompt, retryPrompt);
    const recheck = enforceNominalStyle(second);
    if (recheck.violations.length > 0) {
      console.warn(`[nominal-style] Auch Retry enthält Verstöße: ${recheck.violations.join(", ")}`);
    }
    return second;
  } catch (e) {
    console.warn("[nominal-style] Retry fehlgeschlagen, behalte Erstversuch", e);
    return first;
  }
}

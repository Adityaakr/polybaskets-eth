/**
 * Country name → flag image. Polymarket only ships a generic soccer-ball icon for matches, so we
 * resolve real national flags from flagcdn.com (free, reliable) by ISO 3166-1 alpha-2 code.
 * Home-nations use flagcdn's `gb-eng` / `gb-sct` / `gb-wls` subdivisions.
 */

const ISO: Record<string, string> = {
  // CONMEBOL
  argentina: "ar", brazil: "br", uruguay: "uy", colombia: "co", ecuador: "ec",
  paraguay: "py", peru: "pe", chile: "cl", bolivia: "bo", venezuela: "ve",
  // UEFA
  spain: "es", france: "fr", england: "gb-eng", scotland: "gb-sct", wales: "gb-wls",
  germany: "de", portugal: "pt", netherlands: "nl", italy: "it", belgium: "be",
  croatia: "hr", denmark: "dk", switzerland: "ch", "czech republic": "cz", czechia: "cz",
  poland: "pl", austria: "at", serbia: "rs", ukraine: "ua", "bosnia and herzegovina": "ba",
  norway: "no", sweden: "se", turkey: "tr", turkiye: "tr", "türkiye": "tr", greece: "gr",
  hungary: "hu", romania: "ro", slovakia: "sk", slovenia: "si", ireland: "ie",
  // CONCACAF
  "united states": "us", usa: "us", mexico: "mx", canada: "ca", "costa rica": "cr",
  panama: "pa", jamaica: "jm", honduras: "hn", haiti: "ht", "curacao": "cw", "curaçao": "cw",
  // CAF
  morocco: "ma", senegal: "sn", "south africa": "za", egypt: "eg", nigeria: "ng",
  ghana: "gh", cameroon: "cm", tunisia: "tn", algeria: "dz", ivorycoast: "ci",
  "ivory coast": "ci", "cote d'ivoire": "ci", "côte d'ivoire": "ci", mali: "ml",
  "cabo verde": "cv", "cape verde": "cv", "burkina faso": "bf",
  // AFC
  japan: "jp", "south korea": "kr", "korea republic": "kr", korea: "kr",
  australia: "au", iran: "ir", "saudi arabia": "sa", qatar: "qa", iraq: "iq",
  uzbekistan: "uz", jordan: "jo", "united arab emirates": "ae", uae: "ae",
  // OFC
  "new zealand": "nz",
};

function norm(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** ISO code for a country name, or null if unknown. */
export function isoCode(name: string): string | null {
  const n = norm(name);
  return ISO[n] ?? ISO[n.replace(/\./g, "")] ?? null;
}

/** Flag image URL (80px wide PNG) for a country name, or null if we can't resolve it. */
export function flagUrl(name: string): string | null {
  const code = isoCode(name);
  return code ? `https://flagcdn.com/w80/${code}.png` : null;
}

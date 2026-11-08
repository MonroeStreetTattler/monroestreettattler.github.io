// Address lookup with the U.S. Census Geocoder (no key, server-side only: it does not
// allow browser calls). A port of ../../santa_map/geocoder.py. Results are cached in D1.

const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const USER_AGENT = 'MonroeStreetTattler-SantaMap/1.0 (+https://monroestreettattler.com/santa-map.html)';
const TIMEOUT_MS = 8000;

export class GeocoderUnavailable extends Error {}

export function cleanText(value) {
  return value.replace(/[\x00-\x1f\x7f]/g, ' ').split(/\s+/).filter(Boolean).join(' ');
}

// Routine local reports need only a house number and street: add Madison, WI
// unless the visitor already gave a city, state or ZIP code.
export function queryFor(entered) {
  const text = cleanText(entered);
  const lower = text.toLowerCase();
  if (lower.includes('madison') || /\b\d{5}\b/.test(text) || /,\s*wi(sconsin)?\b/.test(lower)) return text;
  return text + ', Madison, WI';
}

export function queryKey(entered) {
  return queryFor(entered).toLowerCase();
}

// baseUrl is only for local tests (SANTA_GEOCODER_URL, never set in wrangler.toml).
export async function censusLookup(query, baseUrl = CENSUS_URL) {
  const url = baseUrl + '?' + new URLSearchParams({ address: query, benchmark: 'Public_AR_Current', format: 'json' });
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error('status ' + res.status);
    const data = await res.json();
    const matches = data.result.addressMatches.map((m) => ({
      address: cleanText(m.matchedAddress),
      lat: Number(m.coordinates.y), lon: Number(m.coordinates.x),
    }));
    if (matches.some((m) => !m.address || !Number.isFinite(m.lat) || !Number.isFinite(m.lon))) throw new Error('bad answer');
    return matches;
  } catch (e) {
    throw new GeocoderUnavailable(String(e && e.message));
  }
}

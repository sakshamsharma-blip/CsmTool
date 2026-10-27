import { allCountries } from "country-region-data";
import { INDIA_CITIES } from "./indiaCities";

// Country -> State/Region cascading data (country-region-data, MIT licensed). Deliberately NOT
// using a country+state+city package here — those bundle a worldwide city list that's either
// GPL-licensed or tens of MB uncompressed. Cities (decision Oct 27 2026): India comes from a small
// built-in list (lib/indiaCities.js); any other country asks a free public service
// (countriesnow.space) for the state's cities, falling back to cities already on our labs if it's
// down. City always stays type-anything.
export function getCountryNames() {
  return allCountries.map(([name]) => name);
}

// Returns the state/region names for a country, or [] if this dataset has none for it (a few
// small countries/territories) — callers should fall back to a free-text State input in that case.
export function getStatesForCountry(countryName) {
  const entry = allCountries.find(([name]) => name === countryName);
  return entry ? entry[2].map(([name]) => name) : [];
}

// City suggestions sourced from labs already in the system — scoped to the selected state when
// there is one, otherwise every known city. Used to back a <datalist> so City stays free text
// (never blocks on an unrecognized city) while still cutting down on typos/duplicates.
export function cityOptionsFor(labs, state) {
  const pool = state ? labs.filter((l) => l.state === state) : labs;
  return [...new Set(pool.map((l) => l.city).filter(Boolean))].sort();
}

// Cities for a country + state, best first: India's built-in list, otherwise the online service (cached per session,
// 6-second timeout, [] on any failure). Always merged with cities already used on our labs in that state.
const cityCache = new Map();
export async function fetchCities(country, state) {
  if (!country || !state) return [];
  if (country === "India") return INDIA_CITIES[state] || [];
  const key = `${country}|${state}`;
  if (cityCache.has(key)) return cityCache.get(key);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const url = `https://countriesnow.space/api/v0.1/countries/state/cities/q?country=${encodeURIComponent(country)}&state=${encodeURIComponent(state)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    const json = await res.json();
    const list = !json.error && Array.isArray(json.data) ? json.data.filter((c) => typeof c === "string" && c.trim()) : [];
    cityCache.set(key, list);
    return list;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

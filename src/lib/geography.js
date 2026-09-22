import { allCountries } from "country-region-data";

// Country -> State/Region cascading data (country-region-data, MIT licensed). Deliberately NOT
// using a country+state+city package here — those bundle a worldwide city list that's either
// GPL-licensed or tens of MB uncompressed, which isn't worth it for a tool whose labs are
// overwhelmingly in a handful of countries. City instead uses free text with suggestions drawn
// from labs already in the system (see cityOptionsFor below) — zero bundle cost, and the
// suggestions are actually the cities CSMs use, not a generic worldwide list.
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

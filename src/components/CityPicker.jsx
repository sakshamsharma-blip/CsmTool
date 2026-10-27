import { useEffect, useState } from "react";
import SearchSelect from "./SearchSelect";
import { fetchCities, cityOptionsFor } from "../lib/geography";

// City dropdown that follows the chosen State: India from the built-in list, other countries from the online city
// service, always plus cities already used on our labs. Type to filter; a city that isn't listed can still be used
// ("Use “…”"). Used by Add Lab and Lab Details.
export default function CityPicker({ country, state, value, onChange, labs, disabled, inputStyle }) {
  const [fetched, setFetched] = useState({ key: "", list: [] });
  const key = `${country}|${state}`;
  useEffect(() => {
    if (!country || !state) return undefined;
    let cancelled = false;
    fetchCities(country, state).then((list) => { if (!cancelled) setFetched({ key, list }); });
    return () => { cancelled = true; };
  }, [country, state, key]);
  const loading = !!country && !!state && fetched.key !== key;
  const names = [...new Set([...(fetched.key === key ? fetched.list : []), ...cityOptionsFor(labs || [], state)])]
    .sort((a, b) => a.localeCompare(b));
  return (
    <SearchSelect
      value={value}
      onChange={onChange}
      options={names.map((n) => ({ value: n, label: n }))}
      allowCustom
      disabled={disabled}
      inputStyle={inputStyle}
      placeholder={!state ? "Select a State first (or type)" : loading ? "Loading cities…" : names.length ? "Search a city…" : "Type the city"}
    />
  );
}

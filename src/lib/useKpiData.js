import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { fetchAllLabsAdoption, groupScores } from "./adoption";
import { fetchAllPitchStatus } from "./pitch";
import { fetchAllParamChanges, labScoresAt } from "./scoreHistory";
import { fetchAllLabContacts } from "./labContacts";
import { fetchAllVisits } from "./visits";
import { fetchChurnLog } from "./churn";
import { fetchAllInvoices } from "./invoices";
import { fetchAllMrrSnapshots } from "./labs";
import { fetchAllTasks } from "./tasks";
import { fetchAllPurchases } from "./purchases";
import { fetchAllExpansionOpportunities } from "./expansion";
import { defaultKpiSettings, fetchKpiSettings } from "./kpi";
import { asOfMs } from "./periods";

const groupBy = (rows) => {
  const out = {};
  rows.forEach((r) => { (out[r.labId] = out[r.labId] || []).push(r); });
  return out;
};

// Everything the Adoption, Expansion and KPI screens measure, loaded once per screen. `scoresAt(period)` gives each lab's
// scores as they stood at that period's end (remembered, since charts ask for the same period many times);
// `clientScores(group, period)` averages them across a client's labs (null when none of its labs existed yet).
export function useKpiData({ labs, modules, plans, idByName }) {
  const [state, setState] = useState({ loading: SUPABASE_CONFIGURED, error: null, data: null });
  const cache = useRef(new Map());

  const load = useCallback(async () => {
    if (!SUPABASE_CONFIGURED) return;
    setState((s) => ({ ...s, loading: !s.data, error: null }));
    try {
      const nameById = Object.fromEntries(Object.entries(idByName || {}).map(([name, id]) => [id, name]));
      const [adoptionByLab, pitchByLab, changesByLab, contacts, visits, churn, invoices, snaps, tasks, opps, settings, purchases] = await Promise.all([
        fetchAllLabsAdoption(), fetchAllPitchStatus(), fetchAllParamChanges(), fetchAllLabContacts(), fetchAllVisits(), fetchChurnLog(),
        fetchAllInvoices(), fetchAllMrrSnapshots(), fetchAllTasks(nameById), fetchAllExpansionOpportunities(),
        fetchKpiSettings().catch(() => defaultKpiSettings()), fetchAllPurchases().catch(() => []),
      ]);
      cache.current = new Map();
      setState({
        loading: false, error: null,
        data: { adoptionByLab, pitchByLab, changesByLab, contacts, visits, visitsByLab: groupBy(visits), churn, invoices, snapsByLab: groupBy(snaps), tasks, opps, settings, purchases },
      });
    } catch (err) {
      setState({ loading: false, error: err.message || "Failed to load.", data: null });
    }
  }, [idByName]);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const data = useMemo(() => (state.data ? { ...state.data, allLabs: labs, modules, plans } : null), [state.data, labs, modules, plans]);

  const scoresAt = useCallback((period) => {
    if (!data) return {};
    if (cache.current.labs !== labs) { cache.current = new Map(); cache.current.labs = labs; }
    const key = period ? period.key : "now";
    if (!cache.current.has(key)) cache.current.set(key, labScoresAt(labs, data, period ? asOfMs(period) : Date.now()));
    return cache.current.get(key);
  }, [data, labs]);

  const clientScores = useCallback((group, period) => {
    const at = scoresAt(period);
    const list = group.labs.map((l) => at[l.id]).filter(Boolean);
    return list.length ? groupScores(list) : null;
  }, [scoresAt]);

  return { ...state, data, reload: load, scoresAt, clientScores };
}

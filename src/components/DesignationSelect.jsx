import { useState } from "react";
import { POC_DESIGNATIONS } from "../lib/labContacts";

// POC designation picker: the standard list, plus "Other…" to type one that isn't listed. A value saved before the
// list existed (free text) shows as its own option so editing a POC never silently changes it.
export default function DesignationSelect({ value, onChange, style }) {
  const listed = !value || POC_DESIGNATIONS.includes(value);
  const [choseOther, setOther] = useState(false);
  const other = choseOther || !listed; // follows a value set from outside (e.g. picking a POC in Log Check-in)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <select style={style} value={other ? "__other" : value || ""}
        onChange={(e) => {
          if (e.target.value === "__other") { setOther(true); onChange(listed ? "" : value); }
          else { setOther(false); onChange(e.target.value); }
        }}>
        <option value="">— Select designation —</option>
        {POC_DESIGNATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        <option value="__other">Other…</option>
      </select>
      {other && <input style={style} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder="Type the designation" autoFocus />}
    </div>
  );
}

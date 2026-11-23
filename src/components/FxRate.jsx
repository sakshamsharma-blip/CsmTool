import { getUsdInrInfo } from "../lib/fx";

// Today's USD → INR rate (ECB via Frankfurter), shown at the right of the My Labs / Team View row.
export default function FxRate() {
  const fx = getUsdInrInfo();
  const day = fx.date ? new Date(fx.date + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null;
  return <span className="fx-line" title={day ? `European Central Bank rate for ${day}` : "Fallback rate"}>$1 = ₹{fx.rate.toFixed(2)}</span>;
}

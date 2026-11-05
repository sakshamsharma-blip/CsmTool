// Sidebar icons (mapping and colours from the Icon Mapping & Color Guide, Nov 2026): a white glyph on a coloured tile.
// Tile colours are the --ic-* variables in index.css.
const GLYPHS = {
  dashboard: <><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2" fill="currentColor" stroke="none" /><rect x="13" y="3.5" width="7.5" height="7.5" rx="2" fill="currentColor" stroke="none" /><rect x="3.5" y="13" width="7.5" height="7.5" rx="2" fill="currentColor" stroke="none" /><rect x="13" y="13" width="7.5" height="7.5" rx="2" fill="currentColor" stroke="none" /></>,
  portfolio: <><rect x="3" y="7.5" width="18" height="13" rx="2.5" /><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5M3 13h18M12 12v2" /></>,
  customers: <><path d="M4 21V5a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 13 5v16M13 11h5.5A1.5 1.5 0 0 1 20 12.5V21M2.5 21h19" /><path d="M7.5 8h2M7.5 12h2M7.5 16h2M16 15h.5M16 18h.5" /></>,
  collections: <path d="M6 4h12M6 9h12M6 14h3.5a5 5 0 0 0 0-10M6 14l8.5 7" />,
  expansion: <><path d="M2.5 17.5 9 11l4.5 4.5L21.5 7" /><path d="M15.5 7h6v6" /></>,
  tasks: <><path d="m3 6.5 2 2 3.5-3.5M3 16.5l2 2 3.5-3.5" /><path d="M12.5 7H21M12.5 17H21" /></>,
  visits: <><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M8 3v4M16 3v4M3 10.5h18" /><path d="M8 14.5h.01M12 14.5h.01M16 14.5h.01M8 18h.01M12 18h.01" strokeWidth="2.6" /></>,
  adoption: <><rect x="8.5" y="2.5" width="7" height="4" rx="1.2" /><path d="M15.5 4.5H18a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2.5" /><path d="M8 11.5h.01M8 16h.01" strokeWidth="2.6" /><path d="M11.5 11.5H16M11.5 16H16" /></>,
  reports: <><rect x="4" y="13" width="4" height="7.5" rx="1.2" fill="currentColor" stroke="none" /><rect x="10" y="8.5" width="4" height="12" rx="1.2" fill="currentColor" stroke="none" /><rect x="16" y="3.5" width="4" height="17" rx="1.2" fill="currentColor" stroke="none" /></>,
  feedback: <><path d="M5 3.5h14A2.5 2.5 0 0 1 21.5 6v10a2.5 2.5 0 0 1-2.5 2.5h-5.5L9 22v-3.5H5A2.5 2.5 0 0 1 2.5 16V6A2.5 2.5 0 0 1 5 3.5Z" /><path d="m12 6.8 1.25 2.55 2.8.4-2.03 1.98.48 2.8L12 13.2l-2.5 1.33.48-2.8-2.03-1.98 2.8-.4Z" fill="currentColor" stroke="none" /></>,
  resources: <path d="M12 7v14M12 7a4.5 4.5 0 0 0-4.5-3.5H3a1 1 0 0 0-1 1V17a1 1 0 0 0 1 1h5.5A3.5 3.5 0 0 1 12 21a3.5 3.5 0 0 1 3.5-3H21a1 1 0 0 0 1-1V4.5a1 1 0 0 0-1-1h-4.5A4.5 4.5 0 0 0 12 7Z" />,
  support: <><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="2.5" y="13" width="4" height="6.5" rx="1.6" /><rect x="17.5" y="13" width="4" height="6.5" rx="1.6" /><path d="M19.5 19.5v.5a2.5 2.5 0 0 1-2.5 2.5h-3.5" /></>,
  kpi: <><circle cx="11" cy="13" r="8.5" /><circle cx="11" cy="13" r="4.5" /><path d="M11 13 21 3M17.5 3H21v3.5" /></>,
};

export default function NavIcon({ name, color }) {
  return (
    <span className="ico nav-tile" style={{ background: `var(--ic-${color})` }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{GLYPHS[name]}</svg>
    </span>
  );
}

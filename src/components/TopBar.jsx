import { useEffect, useRef, useState } from "react";
import { supabase, SUPABASE_CONFIGURED } from "../supabaseClient";
import { hasLeadAccess, roleLabel } from "../lib/roles";

export default function TopBar({ currentCSM, csmDirectory, myName, view, setView, showToast }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const initials = (name) => (name || "").split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  // This menu is always about the real signed-in person, not whoever an Admin is
  // currently previewing as — that's the Sidebar's separate "viewing as" switcher.
  const accountName = SUPABASE_CONFIGURED ? (myName || currentCSM) : currentCSM;
  const accountRole = roleLabel(csmDirectory.find((c) => c.name === accountName)?.role);
  // What Manage Users offers still follows the previewed role, same as every other
  // Admin/Lead-only affordance in the app (e.g. Team View) — so preview mode stays honest.
  const canManageUsers = hasLeadAccess(csmDirectory.find((c) => c.name === currentCSM)?.role);

  async function handleChangePassword() {
    setMenuOpen(false);
    if (!supabase) return;
    const { data: { session } } = await supabase.auth.getSession();
    const email = session?.user?.email;
    if (!email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    showToast && showToast(error ? "Couldn't send reset email — try again." : `Password reset link sent to ${email}.`);
  }

  function handleLogout() {
    setMenuOpen(false);
    supabase && supabase.auth.signOut().then(() => location.reload());
  }

  return (
    <div className="topbar">
      <div className="search">🔍&nbsp; Search by Lab ID, Lab Name, CSM, City...</div>
      <div className="topbar-spacer"></div>
      <div className="account-menu" ref={menuRef}>
        <button type="button" className={`account-trigger${menuOpen ? " open" : ""}`} onClick={() => setMenuOpen((o) => !o)}>
          <div className="avatar" style={{ width: 30, height: 30, fontSize: "11.5px" }}>{initials(accountName)}</div>
          <div className="account-id">
            <div className="account-name">{accountName}</div>
            <div className="account-role">{accountRole}</div>
          </div>
          <span className={`account-caret${menuOpen ? " open" : ""}`}>▾</span>
        </button>
        {menuOpen && (
          <div className="account-dropdown">
            {canManageUsers && (
              <div className="account-item" onClick={() => { setMenuOpen(false); setView("csm-setup"); }}>
                <span className="aico">👥</span> Manage Users
              </div>
            )}
            {SUPABASE_CONFIGURED && (
              <div className="account-item" onClick={handleChangePassword}>
                <span className="aico">🔒</span> Change Password
              </div>
            )}
            <div className="account-item danger" onClick={handleLogout}>
              <span className="aico">🚩</span> Logout
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

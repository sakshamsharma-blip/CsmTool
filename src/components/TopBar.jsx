import { useEffect, useRef, useState } from "react";
import { supabase, SUPABASE_CONFIGURED } from "../supabaseClient";
import { roleLabel } from "../lib/roles";
import ChangePasswordModal from "./ChangePasswordModal";

export default function TopBar({ viewer, view, setView, showToast, searchQuery, onSearchChange }) {
  const { currentCSM, csmDirectory, myName, isHead: canManageUsers } = viewer;
  const [menuOpen, setMenuOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
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
  // What Manage Users offers still follows the previewed role (viewer.isHead, aliased above),
  // same as every other Admin/Lead-only affordance in the app (e.g. Team View) — so preview
  // mode stays honest.

  function handleChangePassword() {
    setMenuOpen(false);
    setChangePasswordOpen(true);
  }

  function handleLogout() {
    setMenuOpen(false);
    supabase && supabase.auth.signOut().then(() => location.reload());
  }

  return (
    <div className="topbar">
      <input
        className="search"
        type="search"
        name="global-search"
        autoComplete="off"
        placeholder="🔍  Search by Lab ID, Lab Name, CSM, City..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") setView("list"); }}
      />
      <div className="topbar-spacer"></div>
      <div className="account-menu" ref={menuRef}>
        <button type="button" className={`account-trigger${menuOpen ? " open" : ""}`} onClick={() => setMenuOpen((o) => !o)}>
          <div className="avatar" style={{ width: 36, height: 36, fontSize: "13px" }}>{initials(accountName)}</div>
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
      <ChangePasswordModal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} showToast={showToast} />
    </div>
  );
}

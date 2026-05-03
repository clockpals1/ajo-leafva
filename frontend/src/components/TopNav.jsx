import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { LogOut, Bell, LayoutDashboard, ShieldCheck, Menu, X, User } from "lucide-react";

export default function TopNav() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const isAdmin = user.role === "admin" || user.role === "super_admin";
  const dashLink = isAdmin ? "/admin" : "/dashboard";
  const close = () => setOpen(false);

  return (
    <header className="bg-app border-b sticky top-0 z-40" style={{ borderColor: "var(--border)" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">

        {/* Logo */}
        <Link to={dashLink} onClick={close} className="flex items-center gap-2" data-testid="nav-home">
          <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ background: "var(--primary)" }}></div>
          <div>
            <div className="font-display text-lg font-medium leading-none">Ajo</div>
            <div className="label-eyebrow text-[9px]">Community Finance</div>
          </div>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-2">
          {isAdmin ? (
            <Link to="/admin" className="text-sm flex items-center gap-1 px-3 py-2 rounded hover:bg-[var(--surface)]" data-testid="nav-admin">
              <ShieldCheck size={15} /> Admin
            </Link>
          ) : (
            <Link to="/dashboard" className="text-sm flex items-center gap-1 px-3 py-2 rounded hover:bg-[var(--surface)]" data-testid="nav-dashboard">
              <LayoutDashboard size={15} /> Dashboard
            </Link>
          )}
          <Link to="/notifications" className="p-2 rounded hover:bg-[var(--surface)]" data-testid="nav-notifications" title="Notifications">
            <Bell size={16} />
          </Link>
          <Link to="/profile" className="text-sm px-3 py-2 rounded hover:bg-[var(--surface)] max-w-[140px] truncate" data-testid="nav-profile">
            {user.name}
          </Link>
          <button
            onClick={async () => { await logout(); nav("/login"); }}
            className="btn-secondary !py-1.5 !px-3 text-sm flex items-center gap-1"
            data-testid="nav-logout"
          >
            <LogOut size={14} /> Logout
          </button>
        </nav>

        {/* Mobile: bell + hamburger */}
        <div className="flex sm:hidden items-center gap-1">
          <Link to="/notifications" onClick={close} className="p-2.5 rounded-lg hover:bg-[var(--surface)]" aria-label="Notifications">
            <Bell size={18} />
          </Link>
          <button
            onClick={() => setOpen(o => !o)}
            className="p-2.5 rounded-lg hover:bg-[var(--surface)]"
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="sm:hidden border-t" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
          <div className="px-4 py-3 space-y-0.5">
            <div className="flex items-center gap-2 px-3 py-3 mb-1">
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white text-sm font-bold"
                style={{ background: "var(--primary)" }}>
                {user.name?.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="text-sm font-semibold leading-tight">{user.name}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>{user.email}</div>
              </div>
            </div>

            {isAdmin ? (
              <Link to="/admin" onClick={close}
                className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-[var(--surface)] text-sm font-medium"
                data-testid="mobile-nav-admin">
                <ShieldCheck size={18} style={{ color: "var(--primary)" }} /> Admin Dashboard
              </Link>
            ) : (
              <Link to="/dashboard" onClick={close}
                className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-[var(--surface)] text-sm font-medium"
                data-testid="mobile-nav-dashboard">
                <LayoutDashboard size={18} style={{ color: "var(--primary)" }} /> Dashboard
              </Link>
            )}

            <Link to="/profile" onClick={close}
              className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-[var(--surface)] text-sm font-medium">
              <User size={18} style={{ color: "var(--primary)" }} /> Profile & Bank details
            </Link>

            <div className="pt-2 mt-2 border-t" style={{ borderColor: "var(--border)" }}>
              <button
                onClick={async () => { close(); await logout(); nav("/login"); }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-red-50 text-sm font-medium text-left"
                style={{ color: "#b91c1c" }}
                data-testid="mobile-nav-logout"
              >
                <LogOut size={18} /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

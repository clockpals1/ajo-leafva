import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { LogOut, Bell, LayoutDashboard, ShieldCheck } from "lucide-react";

export default function TopNav() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  if (!user) return null;
  const isAdmin = user.role === "admin" || user.role === "super_admin";

  return (
    <header className="bg-app border-b" style={{ borderColor: "var(--border)" }}>
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link to={isAdmin ? "/admin" : "/dashboard"} className="flex items-center gap-2" data-testid="nav-home">
          <div className="w-8 h-8 rounded-full" style={{ background: "var(--primary)" }}></div>
          <div>
            <div className="font-display text-lg font-medium leading-none">Ajo</div>
            <div className="label-eyebrow text-[9px]">Community Finance</div>
          </div>
        </Link>
        <nav className="flex items-center gap-3">
          {isAdmin ? (
            <Link to="/admin" className="text-sm flex items-center gap-1 px-3 py-2 rounded hover:bg-[var(--surface)]" data-testid="nav-admin">
              <ShieldCheck size={16} /> Admin
            </Link>
          ) : (
            <Link to="/dashboard" className="text-sm flex items-center gap-1 px-3 py-2 rounded hover:bg-[var(--surface)]" data-testid="nav-dashboard">
              <LayoutDashboard size={16} /> Dashboard
            </Link>
          )}
          <Link to="/notifications" className="text-sm flex items-center gap-1 px-3 py-2 rounded hover:bg-[var(--surface)]" data-testid="nav-notifications">
            <Bell size={16} />
          </Link>
          <Link to="/profile" className="text-sm px-3 py-2 rounded hover:bg-[var(--surface)]" data-testid="nav-profile">
            {user.name}
          </Link>
          <button onClick={async () => { await logout(); nav("/login"); }} className="btn-secondary !py-1.5 !px-3 text-sm flex items-center gap-1" data-testid="nav-logout">
            <LogOut size={14} /> Logout
          </button>
        </nav>
      </div>
    </header>
  );
}

import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Users, ShieldCheck, Coins } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-app">
      {/* Nav */}
      <header className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full" style={{ background: "var(--primary)" }}></div>
          <div>
            <div className="font-display text-xl font-medium leading-none">Ajo</div>
            <div className="label-eyebrow text-[9px]">Community Finance</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-sm font-medium" data-testid="nav-login">Sign in</Link>
          <Link to="/register" className="btn-primary text-sm" data-testid="nav-register">Get started</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-6 pt-12 pb-24 grid lg:grid-cols-12 gap-10 items-center">
        <div className="lg:col-span-7">
          <div className="label-eyebrow mb-6">Trusted Rotating Savings · Since Generations</div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl tracking-tighter font-medium leading-[1.05]">
            Run your <span style={{ color: "var(--secondary)" }}>Ajo</span> with the<br />
            transparency of a bank,<br />the warmth of family.
          </h1>
          <p className="mt-6 text-base leading-relaxed max-w-xl" style={{ color: "var(--muted)" }}>
            A controlled, admin-managed contribution platform. Members upload payments, admins approve every cent,
            and every cycle is recorded with a clear audit trail. No spreadsheets. No disputes.
          </p>
          <div className="mt-8 flex gap-3">
            <Link to="/register" className="btn-primary inline-flex items-center gap-2" data-testid="hero-cta-register">
              Create member account <ArrowRight size={16} />
            </Link>
            <Link to="/login" className="btn-secondary" data-testid="hero-cta-login">Admin sign in</Link>
          </div>
          <div className="mt-10 flex flex-wrap gap-6 text-xs" style={{ color: "var(--muted)" }}>
            <div className="flex items-center gap-2"><ShieldCheck size={14}/> Admin-only group creation</div>
            <div className="flex items-center gap-2"><Users size={14}/> Member-controlled visibility</div>
            <div className="flex items-center gap-2"><Coins size={14}/> Cycle-by-cycle ledger</div>
          </div>
        </div>
        <div className="lg:col-span-5">
          <div className="relative rounded-lg overflow-hidden" style={{ aspectRatio: "4/5" }}>
            <img src="https://images.unsplash.com/photo-1761666519882-59ab0dbe5059?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2MzR8MHwxfHNlYXJjaHwzfHxhZnJpY2FuJTIwY29tbXVuaXR5JTIwc21pbGluZyUyMHRvZ2V0aGVyfGVufDB8fHx8MTc3Nzc1NDczM3ww&ixlib=rb-4.1.0&q=85"
              alt="Ajo community" className="w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 30%, rgba(30,63,51,0.5) 100%)" }} />
            <div className="absolute bottom-6 left-6 right-6 text-white">
              <div className="label-eyebrow text-white/80">Transparent Rotation</div>
              <div className="font-display text-2xl mt-1">Every member seen. Every cycle recorded.</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features bento */}
      <section className="max-w-7xl mx-auto px-6 pb-24 grid md:grid-cols-3 gap-6">
        {[
          { t: "Admin-controlled groups", d: "Only admins create groups, set rules, and add members. Members cannot self-join or alter rules." },
          { t: "Proof-of-payment workflow", d: "Members upload receipts. Admins approve or reject each one. Status is visible to both sides instantly." },
          { t: "12-state monthly ledger", d: "Every cycle for every member tracked: Due, Submitted, Paid, Overdue, Carried Forward, Payout Completed and more." },
          { t: "Configurable cycles", d: "Contribution amount, frequency, due date/time, late fees, grace period, payout order — all configurable." },
          { t: "Visibility approvals", d: "Members request privacy preferences; admins approve. Admins always retain full audit visibility." },
          { t: "Audit log", d: "Every action — creation, approval, payout — recorded with actor, timestamp, and target." },
        ].map((f, i) => (
          <div key={i} className="card-tactile p-6 hover-lift" data-testid={`feature-${i}`}>
            <div className="label-eyebrow">0{i+1}</div>
            <h3 className="font-display text-xl mt-2 mb-2">{f.t}</h3>
            <p className="text-sm" style={{ color: "var(--muted)" }}>{f.d}</p>
          </div>
        ))}
      </section>

      <footer className="border-t py-8 text-center text-xs" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
        © 2026 Ajo Platform · Built for community trust.
      </footer>
    </div>
  );
}

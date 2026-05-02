import React, { useEffect, useState } from "react";
import api, { fmtDate } from "../api";
import TopNav from "../components/TopNav";

export default function Notifications() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    api.get("/notifications/my").then(r => setItems(r.data));
    api.post("/notifications/read-all").catch(()=>{});
  }, []);
  return (
    <div className="min-h-screen bg-app">
      <TopNav />
      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className="label-eyebrow mb-2">Notifications</div>
        <h1 className="font-display text-3xl mb-8">Recent activity</h1>
        {items.length === 0 ? (
          <div className="card-tactile p-8 text-sm" style={{color:"var(--muted)"}}>No notifications yet.</div>
        ) : (
          <div className="space-y-3" data-testid="notifications-list">
            {items.map(n => (
              <div key={n.id} className="card-tactile p-4" data-testid={`notif-${n.id}`}>
                <div className="flex items-baseline justify-between">
                  <div className="font-display text-base">{n.title}</div>
                  <div className="text-xs" style={{color:"var(--muted)"}}>{fmtDate(n.timestamp)}</div>
                </div>
                <div className="text-sm mt-1">{n.body}</div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

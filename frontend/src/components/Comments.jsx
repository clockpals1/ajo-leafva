import React, { useEffect, useRef, useState } from "react";
import api from "../api";
import { useAuth } from "../AuthContext";

function initials(name) {
  return (name || "?").split(" ").map(s => s[0]).join("").slice(0, 2).toUpperCase();
}

function timeAgo(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export default function Comments({ groupId }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [body, setBody] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollerRef = useRef(null);
  const lastIdRef = useRef(null);

  const load = async (scroll = false) => {
    try {
      const { data } = await api.get(`/groups/${groupId}/comments`);
      setItems(data);
      if (scroll && scrollerRef.current) {
        setTimeout(() => { scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight; }, 50);
      }
      if (data.length) {
        const newest = data[data.length - 1].id;
        if (lastIdRef.current !== newest && scrollerRef.current) {
          // auto-scroll on new messages
          setTimeout(() => { scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight; }, 50);
          lastIdRef.current = newest;
        }
      }
    } catch {}
  };
  useEffect(() => { load(true); const t = setInterval(() => load(false), 5000); return () => clearInterval(t); }, [groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setLoading(true); setErr("");
    try {
      await api.post(`/groups/${groupId}/comments`, { body });
      setBody(""); await load(true);
    } catch (e) { setErr(e?.response?.data?.detail || "Failed"); }
    finally { setLoading(false); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this message?")) return;
    await api.delete(`/groups/${groupId}/comments/${id}`);
    load();
  };

  return (
    <div className="card-tactile p-6" data-testid="comments-section">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-display text-xl">Group chat</h3>
        <span className="text-xs" style={{color:"var(--muted)"}}>Polls every 5s</span>
      </div>

      <div ref={scrollerRef} className="space-y-3 max-h-[460px] overflow-y-auto pr-2 mb-4" data-testid="comments-list">
        {items.length === 0 && (
          <div className="text-sm py-10 text-center" style={{color:"var(--muted)"}}>
            No messages yet — say hello to the group.
          </div>
        )}
        {items.map(c => {
          const self = c.is_self;
          return (
            <div key={c.id} className={`flex gap-2 ${self ? "flex-row-reverse" : ""}`} data-testid={`comment-${c.id}`}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                   style={{background: self ? "var(--primary)" : "var(--accent)", color: "#fff"}}>
                {initials(c.user_name)}
              </div>
              <div className={`max-w-[75%] ${self ? "items-end text-right" : "items-start text-left"} flex flex-col`}>
                <div className="text-xs mb-1 flex items-center gap-2" style={{color:"var(--muted)"}}>
                  <span className="font-medium" style={{color:"var(--text)"}}>{self ? "You" : c.user_name}</span>
                  {c.is_admin && <span className="badge s-Paid !py-0 !px-2 text-[10px]">admin</span>}
                  <span>· {timeAgo(c.created_at)}</span>
                </div>
                <div className="px-4 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words"
                     style={{
                       background: self ? "var(--primary)" : "white",
                       color: self ? "#fff" : "var(--text)",
                       border: self ? "none" : "1px solid var(--border)",
                       borderTopRightRadius: self ? 4 : undefined,
                       borderTopLeftRadius: self ? undefined : 4,
                     }}>
                  {c.body}
                </div>
                {(self || user?.role === "admin" || user?.role === "super_admin") && (
                  <button onClick={()=>remove(c.id)} className="text-[10px] mt-1 opacity-60 hover:opacity-100"
                          data-testid={`del-comment-${c.id}`}>delete</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={post} className="flex gap-2">
        <input value={body} onChange={e=>setBody(e.target.value)} placeholder="Type a message…"
          className="flex-1 border rounded-full px-4 py-2 bg-white" data-testid="comment-input" />
        <button disabled={loading} className="btn-primary !rounded-full text-sm px-5" data-testid="comment-submit">
          {loading ? "…" : "Send"}
        </button>
      </form>
      {err && <div className="text-sm text-red-700 mt-2" data-testid="comment-error">{err}</div>}
    </div>
  );
}

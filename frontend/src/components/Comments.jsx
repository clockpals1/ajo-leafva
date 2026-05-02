import React, { useEffect, useState } from "react";
import api, { fmtDate } from "../api";

export default function Comments({ groupId }) {
  const [items, setItems] = useState([]);
  const [body, setBody] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const load = () => api.get(`/groups/${groupId}/comments`).then(r=>setItems(r.data)).catch(()=>{});
  useEffect(() => { load(); }, [groupId]);

  const post = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setLoading(true); setErr("");
    try {
      await api.post(`/groups/${groupId}/comments`, { body });
      setBody(""); load();
    } catch (e) { setErr(e?.response?.data?.detail || "Failed"); }
    finally { setLoading(false); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this comment?")) return;
    await api.delete(`/groups/${groupId}/comments/${id}`);
    load();
  };

  return (
    <div className="card-tactile p-6" data-testid="comments-section">
      <h3 className="font-display text-xl mb-4">Group activity & comments</h3>
      <form onSubmit={post} className="flex gap-2 mb-6">
        <input value={body} onChange={e=>setBody(e.target.value)} placeholder="Share an update or a question…"
          className="flex-1 border rounded px-3 py-2 bg-white" data-testid="comment-input" />
        <button disabled={loading} className="btn-primary text-sm" data-testid="comment-submit">
          {loading ? "Posting…" : "Post"}
        </button>
      </form>
      {err && <div className="text-sm text-red-700 mb-3" data-testid="comment-error">{err}</div>}
      {items.length === 0 ? (
        <div className="text-sm" style={{color:"var(--muted)"}}>No comments yet — start the conversation.</div>
      ) : (
        <div className="space-y-3" data-testid="comments-list">
          {items.map(c => (
            <div key={c.id} className="border-t pt-3" style={{borderColor:"var(--border)"}} data-testid={`comment-${c.id}`}>
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-medium">
                  {c.user_name}
                  {c.is_admin && <span className="badge s-Paid ml-2">admin</span>}
                  {c.cycle_no && <span className="text-xs ml-2" style={{color:"var(--muted)"}}>· Cycle #{c.cycle_no}</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs" style={{color:"var(--muted)"}}>{fmtDate(c.created_at)} {c.created_at.slice(11,16)}</span>
                  <button onClick={()=>remove(c.id)} className="text-xs text-red-700" data-testid={`del-comment-${c.id}`}>Delete</button>
                </div>
              </div>
              <div className="text-sm mt-1 whitespace-pre-wrap">{c.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

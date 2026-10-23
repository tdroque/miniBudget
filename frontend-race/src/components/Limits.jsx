import { useState } from "react";
import { api } from "../api";
import { formatMoney } from "../dateUtils";
import { toneFor } from "../summary";
import LimitForm from "./LimitForm.jsx";
import "./Budget.css";

export default function Limits({ view, scope, categories, loading, onChanged }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState("");

  const single = scope !== "all" ? view.races[0] : null;

  // Single race: the real limits. All races: one row per category, summed.
  const rows = single
    ? view.limits.map((l) => ({ key: l.id, limit: l, category: l.category, amount: l.amount }))
    : [...view.limits.reduce((m, l) => m.set(l.category, (m.get(l.category) || 0) + l.amount), new Map())].map(([category, amount]) => ({
        key: category,
        category,
        amount,
      }));

  async function handleDelete(id) {
    setError("");
    setDeletingId(id);
    try {
      await api.deleteLimit(id);
      onChanged();
    } catch (err) {
      setError(err.message || "Couldn't delete that limit.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="budget-tab">
      <section className="card">
        <div className="section-header">
          <h2 className="section-title">Limits{single ? ` · ${single.name}` : ""}</h2>
          {single && (
            <button
              className="btn btn--sm btn--stamp"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              + Add limit
            </button>
          )}
        </div>

        {!single && view.races.length > 0 && (
          <p className="text-muted">Combined across all races. Pick a single race above to add or change limits.</p>
        )}
        {error && <div className="banner banner--error">{error}</div>}
        {loading && <p className="text-muted">Loading…</p>}
        {!loading && rows.length === 0 && (
          <div className="banner banner--empty">
            {view.races.length === 0
              ? "Add a race first."
              : "No limits yet. A limit caps one kind of cost for a race, like Travel or Food."}
          </div>
        )}

        <ul className="budget-list">
          {rows.map((r) => {
            const spent = view.spentByCategory.get(r.category) || 0;
            const ratio = r.amount > 0 ? spent / r.amount : 0;
            const tone = toneFor(ratio);
            const fillPct = Math.min(ratio, 1) * 100;
            const overflowPct = ratio > 1 ? Math.min(ratio - 1, 1) * 100 : 0;
            return (
              <li className="budget-row" key={r.key}>
                <div className="budget-row__top">
                  <span className="budget-row__name">{r.category}</span>
                  {r.limit && (
                    <div className="budget-row__actions">
                      <button
                        className="icon-btn"
                        onClick={() => {
                          setEditing(r.limit);
                          setFormOpen(true);
                        }}
                        aria-label={`Edit ${r.category} limit`}
                      >
                        ✎
                      </button>
                      <button
                        className="icon-btn icon-btn--danger"
                        onClick={() => handleDelete(r.limit.id)}
                        disabled={deletingId === r.limit.id}
                        aria-label={`Delete ${r.category} limit`}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
                <div className="budget-row__amounts">
                  <span className={`mono budget-row__spent budget-row__spent--${tone}`}>{formatMoney(spent)}</span>
                  <span className="budget-row__of">of {formatMoney(r.amount)}</span>
                  {ratio > 1 && <span className="budget-row__over-tag">over limit</span>}
                </div>
                <div className="budget-row__track">
                  <div className={`budget-row__fill budget-row__fill--${tone}`} style={{ width: `${fillPct}%` }} />
                  {overflowPct > 0 && <div className="budget-row__overflow" style={{ width: `${overflowPct}%` }} />}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {formOpen && single && (
        <LimitForm
          key={editing ? editing.id : "new"}
          limit={editing}
          raceId={single.id}
          categories={categories}
          usedCategories={view.limits.map((l) => l.category)}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSaved={() => {
            setFormOpen(false);
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

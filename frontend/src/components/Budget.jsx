import { useState } from "react";
import { api } from "../api";
import { formatMoney } from "../dateUtils";
import BudgetForm from "./BudgetForm.jsx";
import "./Budget.css";

function toneFor(ratio) {
  if (ratio > 1) return "over";
  if (ratio > 0.8) return "warn";
  return "ok";
}

export default function Budget({ budgets, summary, loading, categories, onChanged }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState("");

  const spentByCategory = new Map();
  (summary?.by_category || []).forEach((c) => {
    if (c.type === "expense") spentByCategory.set(c.category.toLowerCase(), c.amount);
  });

  function openAdd() {
    setEditingBudget(null);
    setFormOpen(true);
  }
  function openEdit(b) {
    setEditingBudget(b);
    setFormOpen(true);
  }
  async function handleDelete(id) {
    setError("");
    setDeletingId(id);
    try {
      await api.deleteBudget(id);
      onChanged();
    } catch (err) {
      setError(err.message || "Couldn't delete that budget.");
    } finally {
      setDeletingId(null);
    }
  }
  function handleSaved() {
    setFormOpen(false);
    setEditingBudget(null);
    onChanged();
  }

  return (
    <div className="budget-tab">
      <section className="card">
        <div className="section-header">
          <h2 className="section-title">Budgets</h2>
          <button className="btn btn--sm btn--stamp" onClick={openAdd}>
            + Add budget
          </button>
        </div>

        {error && <div className="banner banner--error">{error}</div>}

        {loading && <p className="text-muted">Loading…</p>}

        {!loading && budgets.length === 0 && (
          <div className="banner banner--empty">
            No budgets yet. Add one to track spending in a category against a limit for the period selected above.
          </div>
        )}

        <ul className="budget-list">
          {budgets.map((b) => {
            const spent = spentByCategory.get(b.category.toLowerCase()) || 0;
            const ratio = b.amount > 0 ? spent / b.amount : 0;
            const tone = toneFor(ratio);
            const fillPct = Math.min(ratio, 1) * 100;
            const overflowPct = ratio > 1 ? Math.min(ratio - 1, 1) * 100 : 0;

            return (
              <li className="budget-row" key={b.id}>
                <div className="budget-row__top">
                  <span className="budget-row__name">{b.category}</span>
                  <div className="budget-row__actions">
                    <button className="icon-btn" onClick={() => openEdit(b)} aria-label={`Edit ${b.category} budget`}>
                      ✎
                    </button>
                    <button
                      className="icon-btn icon-btn--danger"
                      onClick={() => handleDelete(b.id)}
                      disabled={deletingId === b.id}
                      aria-label={`Delete ${b.category} budget`}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <div className="budget-row__amounts">
                  <span className={`mono budget-row__spent budget-row__spent--${tone}`}>{formatMoney(spent)}</span>
                  <span className="budget-row__of">of {formatMoney(b.amount)}</span>
                  {ratio > 1 && <span className="budget-row__over-tag">over budget</span>}
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

      {formOpen && (
        <BudgetForm
          key={editingBudget ? editingBudget.id : "new"}
          budget={editingBudget}
          categories={categories}
          onClose={() => {
            setFormOpen(false);
            setEditingBudget(null);
          }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

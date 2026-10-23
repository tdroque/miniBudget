import { useState } from "react";
import { api } from "../api";
import { formatMoney, formatShortDate, toISODate } from "../dateUtils";
import { sortCosts } from "../summary";
import "./TransactionList.css";

export default function Costs({ costs, races, categoryNames, categoryFilter, onCategoryFilter, showRace, loading, onEdit, onChanged, onNotice, budgetCategory }) {
  const [busyId, setBusyId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [error, setError] = useState("");

  const raceName = (id) => races.find((r) => r.id === id)?.name || "";
  const rows = sortCosts(costs.filter((c) => !categoryFilter || c.category === categoryFilter));

  async function run(id, fn) {
    setError("");
    setBusyId(id);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  }

  const toggle = (c) => {
    const nowPaid = c.status !== "paid";
    return run(c.id, () =>
      api.updateCost(c.id, { ...c, status: nowPaid ? "paid" : "planned", date: c.date || (nowPaid ? toISODate(new Date()) : "") })
    );
  };

  const send = (c) =>
    run(c.id, async () => {
      await api.addCostToBudget(c.id);
      onNotice(`Added “${c.name}” to Mini Budget under “${budgetCategory}”.`);
    });

  const unlink = (c) =>
    run(c.id, async () => {
      await api.removeCostFromBudget(c.id);
      onNotice(`Removed “${c.name}” from Mini Budget. It stays here as a paid cost.`);
    });

  const remove = (c) => run(c.id, () => api.deleteCost(c.id));

  return (
    <div className="card">
      <div className="section-header">
        <h2 className="section-title">Costs</h2>
        <select className="select-filter" value={categoryFilter} onChange={(e) => onCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {categoryNames.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="banner banner--error">{error}</div>}
      {loading && <p className="text-muted">Loading…</p>}
      {!loading && rows.length === 0 && (
        <div className="banner banner--empty">Nothing here yet. Tap “Add cost” to plan or log something.</div>
      )}

      <ul className="txn-list">
        {rows.map((c) => {
          const paid = c.status === "paid";
          const linked = Boolean(c.transaction_id);
          const busy = busyId === c.id;
          const meta = [c.date ? formatShortDate(c.date) : "No date", c.category, showRace ? raceName(c.race_id) : ""].filter(Boolean).join(" · ");
          return (
            <li className="txn-row txn-row--wrap" key={c.id}>
              <div className="txn-row__main">
                <button
                  className={`txn-row__icon cost-check ${paid ? "is-paid" : ""}`}
                  onClick={() => toggle(c)}
                  disabled={busy || linked}
                  aria-label={paid ? "Mark as planned" : "Mark as paid"}
                  title={linked ? "In Mini Budget, so it stays paid" : paid ? "Paid — tap to mark planned" : "Planned — tap to mark paid"}
                >
                  {paid ? "✓" : ""}
                </button>
                <div className="txn-row__info">
                  <span className="txn-row__name">
                    {c.name}
                    {!paid && <span className="tag tag--planned">planned</span>}
                    {linked && <span className="tag tag--budget">in Mini Budget</span>}
                  </span>
                  <span className="txn-row__meta">{meta}</span>
                </div>
              </div>
              <div className="txn-row__end">
                <span className="mono txn-row__amount txn-row__amount--expense">{formatMoney(c.amount)}</span>
                <div className="txn-row__actions">
                  {linked ? (
                    <button className="icon-btn" onClick={() => unlink(c)} disabled={busy} aria-label="Remove from Mini Budget" title="Remove from Mini Budget">
                      ↶
                    </button>
                  ) : (
                    <button
                      className="btn btn--sm cost-send"
                      onClick={() => send(c)}
                      disabled={busy || c.id < 0}
                      title={paid ? "Add to Mini Budget" : "Marks this paid and adds it to Mini Budget"}
                    >
                      + Mini Budget
                    </button>
                  )}
                  <button className="icon-btn" onClick={() => onEdit(c)} aria-label="Edit cost">
                    ✎
                  </button>
                  <button
                    className="icon-btn icon-btn--danger"
                    onClick={() => (linked ? setConfirmId(c.id) : remove(c))}
                    disabled={busy}
                    aria-label="Delete cost"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {confirmId === c.id && (
                <div className="cost-confirm">
                  <span>This also removes it from Mini Budget.</span>
                  <button className="btn btn--sm btn--danger" onClick={() => remove(c)}>
                    Delete both
                  </button>
                  <button className="btn btn--sm btn--ghost" onClick={() => setConfirmId(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

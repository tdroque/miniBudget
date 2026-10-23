import { useState } from "react";
import { api } from "../api";
import { formatMoney, formatShortDate } from "../dateUtils";
import RaceBar from "./RaceBar.jsx";
import "./TransactionList.css";

export default function Races({ races, costs, loading, onAdd, onEdit, onChanged }) {
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  async function remove(id) {
    setError("");
    setBusyId(id);
    try {
      await api.deleteRace(id);
      onChanged();
    } catch (err) {
      setError(err.message || "Couldn't delete that race.");
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  }

  return (
    <div className="dashboard">
      <section className="card">
        <div className="section-header">
          <h2 className="section-title">Races</h2>
          <button className="btn btn--sm btn--stamp" onClick={onAdd}>
            + Add race
          </button>
        </div>
        {error && <div className="banner banner--error">{error}</div>}
        {loading && <p className="text-muted">Loading…</p>}
        {!loading && races.length === 0 && <div className="banner banner--empty">No races yet.</div>}
      </section>

      {races.map((r) => {
        const mine = costs.filter((c) => c.race_id === r.id);
        const paid = mine.filter((c) => c.status === "paid").reduce((s, c) => s + c.amount, 0);
        const planned = mine.filter((c) => c.status !== "paid").reduce((s, c) => s + c.amount, 0);
        const linkedCount = mine.filter((c) => c.transaction_id).length;
        return (
          <section className="card" key={r.id}>
            <div className="section-header">
              <div className="txn-row__info">
                <span className="txn-row__name">{r.name}</span>
                <span className="txn-row__meta">
                  {[r.type, r.date ? formatShortDate(r.date) : "No date", `${mine.length} cost${mine.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                </span>
              </div>
              <div className="txn-row__actions">
                <button className="icon-btn" onClick={() => onEdit(r)} aria-label={`Edit ${r.name}`}>
                  ✎
                </button>
                <button className="icon-btn icon-btn--danger" onClick={() => setConfirmId(r.id)} disabled={busyId === r.id} aria-label={`Delete ${r.name}`}>
                  ✕
                </button>
              </div>
            </div>
            <RaceBar budget={Number(r.budget) || 0} paid={paid} planned={planned} compact />
            <div className="race-stats">
              <div>
                <span className="text-muted">Committed</span>
                <span className="mono">{formatMoney(paid + planned)}</span>
              </div>
              <div>
                <span className="text-muted">Budget</span>
                <span className="mono">{formatMoney(Number(r.budget) || 0)}</span>
              </div>
            </div>
            {confirmId === r.id && (
              <div className="cost-confirm">
                <span>
                  Deletes this race and its {mine.length} cost{mine.length === 1 ? "" : "s"}
                  {linkedCount > 0 ? `, including ${linkedCount} in Mini Budget` : ""}.
                </span>
                <button className="btn btn--sm btn--danger" onClick={() => remove(r.id)}>
                  Delete
                </button>
                <button className="btn btn--sm btn--ghost" onClick={() => setConfirmId(null)}>
                  Cancel
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

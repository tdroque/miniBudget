import { formatMoney, formatShortDate } from "../dateUtils";
import { daysUntil } from "../summary";
import RaceBar from "./RaceBar.jsx";
import "./Dashboard.css";

export default function Overview({ view, scope, loading, hasRaces, onAddRace }) {
  if (!hasRaces) {
    return (
      <div className="banner banner--empty">
        {loading ? "Loading…" : "No races yet. Add your first one to start planning what it will cost."}
        {!loading && (
          <div style={{ marginTop: 14 }}>
            <button className="btn btn--stamp" onClick={onAddRace}>
              + Add race
            </button>
          </div>
        )}
      </div>
    );
  }

  const race = scope !== "all" ? view.races[0] : null;
  const days = race ? daysUntil(race.date) : null;
  const max = Math.max(...view.byCategory.map((c) => c.amount), 1);

  return (
    <div className="dashboard">
      <section className="card">
        <div className="section-header">
          <h2 className="section-title">{race ? race.name : "All races"}</h2>
          {race?.date && (
            <span className="text-muted">
              {formatShortDate(race.date)}
              {days !== null && days >= 0 ? ` · ${days} day${days === 1 ? "" : "s"} to go` : " · done"}
            </span>
          )}
        </div>
        <RaceBar budget={view.budget} paid={view.paid} planned={view.planned} />
        <div className="race-stats">
          <div>
            <span className="text-muted">Paid</span>
            <span className="mono">{formatMoney(view.paid)}</span>
          </div>
          <div>
            <span className="text-muted">Still planned</span>
            <span className="mono">{formatMoney(view.planned)}</span>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">By category</h2>
        {view.byCategory.length === 0 ? (
          <div className="banner banner--empty">No costs yet. Add one from the Costs tab.</div>
        ) : (
          <div className="cat-breakdown">
            {view.byCategory.map((c) => (
              <div className="cat-row" key={c.category}>
                <div className="cat-row__top">
                  <span className="cat-row__name">{c.category}</span>
                  <span className="mono">{formatMoney(c.amount)}</span>
                </div>
                <div className="cat-row__track">
                  <div className="cat-row__fill cat-row__fill--expense" style={{ width: `${(c.amount / max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

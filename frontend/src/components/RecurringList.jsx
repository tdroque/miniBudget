import { formatMoney } from "../dateUtils";
import "./TransactionList.css";

const FREQ_LABEL = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly" };

export default function RecurringList({ items, loading, onEdit, onDelete }) {
  return (
    <div className="card">
      <h2 className="section-title">Recurring income &amp; expenses</h2>

      {loading && <p className="text-muted">Loading…</p>}

      {!loading && items.length === 0 && (
        <div className="banner banner--empty">
          No recurring items yet. Add your paycheque or rent so it shows up automatically every period.
        </div>
      )}

      <ul className="txn-list">
        {items.map((it) => (
          <li className="txn-row" key={it.id}>
            <div className="txn-row__main">
              <div className={`txn-row__icon txn-row__icon--${it.type}`}>{it.type === "income" ? "+" : "–"}</div>
              <div className="txn-row__info">
                <span className="txn-row__name">{it.name}</span>
                <span className="txn-row__meta">
                  {FREQ_LABEL[it.frequency]} · {it.category} · from {it.start_date}
                  {it.end_date ? ` to ${it.end_date}` : ""}
                </span>
              </div>
            </div>
            <div className="txn-row__end">
              <span className={`mono txn-row__amount txn-row__amount--${it.type}`}>
                {it.type === "income" ? "+" : "-"}
                {formatMoney(it.amount)}
              </span>
              <div className="txn-row__actions">
                <button className="icon-btn" onClick={() => onEdit(it)} aria-label="Edit recurring item">
                  ✎
                </button>
                <button className="icon-btn icon-btn--danger" onClick={() => onDelete(it.id)} aria-label="Delete recurring item">
                  ✕
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

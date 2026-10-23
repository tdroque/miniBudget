import { api } from "../api";
import { formatMoney, formatShortDate } from "../dateUtils";
import "./TransactionList.css";

export default function TransactionList({
  occurrences,
  loading,
  categoryNames,
  categoryFilter,
  onCategoryFilter,
  onEdit,
  onDelete,
}) {
  return (
    <div className="card">
      <div className="section-header">
        <h2 className="section-title">Entries</h2>
        <select className="select-filter" value={categoryFilter} onChange={(e) => onCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {categoryNames.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="text-muted">Loading…</p>}

      {!loading && occurrences.length === 0 && (
        <div className="banner banner--empty">Nothing in this period yet. Tap "Add entry" to log something.</div>
      )}

      <ul className="txn-list">
        {occurrences.map((o) => (
          <li className="txn-row" key={o.id}>
            <div className="txn-row__main">
              <div className={`txn-row__icon txn-row__icon--${o.type}`}>{o.type === "income" ? "+" : "–"}</div>
              <div className="txn-row__info">
                <span className="txn-row__name">
                  {o.name}
                  {o.source_type === "recurring" && <span className="tag tag--recurring">recurring</span>}
                </span>
                <span className="txn-row__meta">
                  {formatShortDate(o.date)} · {o.category}
                  {o.receipt_path && (
                    <a
                      className="receipt-link"
                      href={api.receiptUrl(o.receipt_path)}
                      target="_blank"
                      rel="noreferrer"
                      title={o.ocr_status === "pending" ? "Receipt attached · OCR pending" : "View receipt"}
                    >
                      📷{o.ocr_status === "pending" ? " ·" : ""}
                    </a>
                  )}
                </span>
              </div>
            </div>
            <div className="txn-row__end">
              <span className={`mono txn-row__amount txn-row__amount--${o.type}`}>
                {o.type === "income" ? "+" : "-"}
                {formatMoney(o.amount)}
              </span>
              {o.source_type === "transaction" ? (
                <div className="txn-row__actions">
                  <button className="icon-btn" onClick={() => onEdit(o)} aria-label="Edit entry">
                    ✎
                  </button>
                  <button className="icon-btn icon-btn--danger" onClick={() => onDelete(o.source_id)} aria-label="Delete entry">
                    ✕
                  </button>
                </div>
              ) : (
                <span className="txn-row__hint">manage in Recurring</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

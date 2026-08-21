import { formatMoney } from "../dateUtils";
import "./Dashboard.css";

function BalanceBar({ income, expense, net }) {
  const denom = Math.max(income, expense, 1);
  const expensePct = Math.min((expense / denom) * 100, 100);
  const overflowPct = expense > income ? Math.min(((expense - income) / denom) * 100, 100) : 0;
  const incomeMarkerPct = Math.min((income / denom) * 100, 100);

  return (
    <div className="balance-bar">
      <div className="balance-bar__labels">
        <div>
          <span className="dot dot--income" />
          <span className="balance-bar__label">Income</span>
          <span className="mono balance-bar__amount balance-bar__amount--income">{formatMoney(income)}</span>
        </div>
        <div className="align-right">
          <span className="balance-bar__label">Expenses</span>
          <span className="dot dot--expense" />
          <span className="mono balance-bar__amount balance-bar__amount--expense">{formatMoney(expense)}</span>
        </div>
      </div>

      <div className="balance-bar__track" role="img" aria-label={`Spent ${formatMoney(expense)} of ${formatMoney(income)} income`}>
        <div className="balance-bar__income-fill" style={{ width: `${incomeMarkerPct}%` }} />
        <div className="balance-bar__expense-fill" style={{ width: `${expensePct}%` }} />
        {overflowPct > 0 && (
          <div className="balance-bar__overflow" style={{ width: `${overflowPct}%`, left: `${incomeMarkerPct}%` }} />
        )}
        <div className="balance-bar__marker" style={{ left: `${incomeMarkerPct}%` }} />
      </div>

      <div className="balance-bar__ruler">
        {Array.from({ length: 11 }).map((_, i) => (
          <span key={i} />
        ))}
      </div>

      <div className={`balance-bar__net ${net >= 0 ? "is-positive" : "is-negative"}`}>
        <span className="balance-bar__net-stamp">{net >= 0 ? "SURPLUS" : "OVER BUDGET"}</span>
        <span className="mono balance-bar__net-amount">{formatMoney(net)}</span>
      </div>
    </div>
  );
}

function CategoryBreakdown({ items }) {
  if (!items || items.length === 0) {
    return <div className="banner banner--empty">No entries yet for this period. Add one to see the breakdown.</div>;
  }

  const max = Math.max(...items.map((i) => i.amount), 1);

  return (
    <div className="cat-breakdown">
      {items.map((c) => (
        <div className="cat-row" key={`${c.type}-${c.category}`}>
          <div className="cat-row__top">
            <span className="cat-row__name">
              {c.category}
              <span className={`tag tag--${c.type}`}>{c.type}</span>
            </span>
            <span className="mono">{formatMoney(c.amount)}</span>
          </div>
          <div className="cat-row__track">
            <div
              className={`cat-row__fill cat-row__fill--${c.type}`}
              style={{ width: `${(c.amount / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard({ summary, loading, categoryFilter, categoryNames, onCategoryFilter }) {
  return (
    <div className="dashboard">
      <section className="card">
        <h2 className="section-title">Balance</h2>
        {summary ? (
          <BalanceBar income={summary.income} expense={summary.expense} net={summary.net} />
        ) : (
          <p className="text-muted">{loading ? "Loading…" : "No data yet."}</p>
        )}
      </section>

      <section className="card">
        <div className="section-header">
          <h2 className="section-title">By category</h2>
          <select
            className="select-filter"
            value={categoryFilter}
            onChange={(e) => onCategoryFilter(e.target.value)}
          >
            <option value="">All categories</option>
            {categoryNames.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <CategoryBreakdown items={summary?.by_category} />
      </section>
    </div>
  );
}

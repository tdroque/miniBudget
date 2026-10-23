import { formatMoney } from "../dateUtils";
import "./Dashboard.css";

// Race Budget's version of Mini Budget's balance bar. The track is the race
// budget; the solid fill is what's been paid, the lighter fill is what's
// still only planned, and anything past the budget line is hatched.
export default function RaceBar({ budget, paid, planned, compact = false }) {
  const committed = paid + planned;
  const denom = Math.max(budget, committed, 1);
  const pct = (n) => Math.min((n / denom) * 100, 100);
  const budgetPct = pct(budget);
  const paidPct = pct(paid);
  const plannedPct = Math.max(pct(committed) - paidPct, 0);
  const overflowPct = committed > budget ? pct(committed) - budgetPct : 0;
  const left = budget - committed;

  return (
    <div className="balance-bar">
      {!compact && (
        <div className="balance-bar__labels">
          <div>
            <span className="dot dot--income" />
            <span className="balance-bar__label">Budget</span>
            <span className="mono balance-bar__amount balance-bar__amount--income">{formatMoney(budget)}</span>
          </div>
          <div className="align-right">
            <span className="balance-bar__label">Committed</span>
            <span className="dot dot--expense" />
            <span className="mono balance-bar__amount balance-bar__amount--expense">{formatMoney(committed)}</span>
          </div>
        </div>
      )}

      <div
        className={`balance-bar__track ${compact ? "balance-bar__track--compact" : ""}`}
        role="img"
        aria-label={`${formatMoney(paid)} paid and ${formatMoney(planned)} planned of ${formatMoney(budget)} budget`}
      >
        <div className="balance-bar__income-fill" style={{ width: `${budgetPct}%` }} />
        <div className="balance-bar__expense-fill" style={{ width: `${paidPct}%` }} />
        {plannedPct > 0 && <div className="balance-bar__planned" style={{ left: `${paidPct}%`, width: `${plannedPct}%` }} />}
        {overflowPct > 0 && <div className="balance-bar__overflow" style={{ width: `${overflowPct}%`, left: `${budgetPct}%` }} />}
        {budget > 0 && <div className="balance-bar__marker" style={{ left: `${budgetPct}%` }} />}
      </div>

      {!compact && (
        <>
          <div className="balance-bar__ruler">
            {Array.from({ length: 11 }).map((_, i) => (
              <span key={i} />
            ))}
          </div>
          <div className={`balance-bar__net ${left >= 0 ? "is-positive" : "is-negative"}`}>
            <span className="balance-bar__net-stamp">{left >= 0 ? "UNDER BUDGET" : "OVER BUDGET"}</span>
            <span className="mono balance-bar__net-amount">{formatMoney(left)}</span>
          </div>
        </>
      )}
    </div>
  );
}

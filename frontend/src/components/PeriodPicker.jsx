import { monthLabel, shiftMonth } from "../dateUtils";
import "./PeriodPicker.css";

export default function PeriodPicker({
  mode,
  year,
  monthIndex,
  customStart,
  customEnd,
  onModeChange,
  onYearChange,
  onMonthChange,
  onCustomStartChange,
  onCustomEndChange,
}) {
  function step(delta) {
    const next = shiftMonth(year, monthIndex, delta);
    onYearChange(next.year);
    onMonthChange(next.monthIndex);
  }

  return (
    <div className="period-picker">
      <div className="period-picker__modes">
        {[
          { id: "month", label: "Month" },
          { id: "year", label: "Year" },
          { id: "custom", label: "Custom" },
        ].map((m) => (
          <button
            key={m.id}
            className={`chip ${mode === m.id ? "chip--active" : ""}`}
            onClick={() => onModeChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "month" && (
        <div className="period-picker__row">
          <button className="btn btn--sm btn--ghost" onClick={() => step(-1)} aria-label="Previous month">
            ‹
          </button>
          <span className="period-picker__label">{monthLabel(year, monthIndex)}</span>
          <button className="btn btn--sm btn--ghost" onClick={() => step(1)} aria-label="Next month">
            ›
          </button>
        </div>
      )}

      {mode === "year" && (
        <div className="period-picker__row">
          <button className="btn btn--sm btn--ghost" onClick={() => onYearChange(year - 1)} aria-label="Previous year">
            ‹
          </button>
          <span className="period-picker__label">{year}</span>
          <button className="btn btn--sm btn--ghost" onClick={() => onYearChange(year + 1)} aria-label="Next year">
            ›
          </button>
        </div>
      )}

      {mode === "custom" && (
        <div className="period-picker__row period-picker__row--custom">
          <label className="field field--inline">
            <span>From</span>
            <input type="date" value={customStart} onChange={(e) => onCustomStartChange(e.target.value)} />
          </label>
          <label className="field field--inline">
            <span>To</span>
            <input type="date" value={customEnd} onChange={(e) => onCustomEndChange(e.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}

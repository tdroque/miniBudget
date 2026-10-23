import { useState } from "react";
import { api } from "../api";
import "./EntryForm.css";

export default function BudgetForm({ budget, categories, onClose, onSaved }) {
  const isEditing = Boolean(budget);
  const [category, setCategory] = useState(budget?.category || "");
  const [amount, setAmount] = useState(budget?.amount ? String(budget.amount) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const expenseCategories = categories.filter((c) => c.type === "expense");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const amountNum = parseFloat(amount);
    if (!category.trim()) return setError("Pick a category.");
    if (!amountNum || amountNum <= 0) return setError("Enter an amount greater than 0.");

    setSaving(true);
    try {
      const payload = { category: category.trim(), amount: amountNum };
      if (isEditing) {
        await api.updateBudget(budget.id, payload);
      } else {
        await api.createBudget(payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message || "Couldn't save this budget.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal__header">
          <h2>{isEditing ? "Edit budget" : "Add budget"}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="entry-form">
          <label className="field">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={isEditing}>
              <option value="">Select…</option>
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
              {/* If editing a budget whose category has since been deleted from
                  Settings, still show it so the select isn't stuck empty. */}
              {isEditing && category && !expenseCategories.some((c) => c.name === category) && (
                <option value={category}>{category}</option>
              )}
            </select>
          </label>
          {expenseCategories.length === 0 && !isEditing && (
            <p className="field-hint">No expense categories yet — add one in Settings first.</p>
          )}
          {isEditing && (
            <p className="field-hint">
              The category can't be changed here — delete this budget and add a new one instead.
            </p>
          )}

          <label className="field">
            <span>Budget amount</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          </label>
          <p className="field-hint">
            Compared against spending in this category for whatever period is currently selected (Month, Year, or
            Custom) — not necessarily a calendar month.
          </p>

          {error && <div className="banner banner--error">{error}</div>}

          <button className="btn btn--stamp btn--full" type="submit" disabled={saving}>
            {saving ? "Saving…" : isEditing ? "Save changes" : "Add budget"}
          </button>
        </form>
      </div>
    </div>
  );
}

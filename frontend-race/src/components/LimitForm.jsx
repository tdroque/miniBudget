import { useState } from "react";
import { api } from "../api";
import Modal from "./Modal.jsx";

export default function LimitForm({ limit, raceId, categories, usedCategories, onClose, onSaved }) {
  const isEditing = Boolean(limit);
  const available = categories.filter((c) => !usedCategories.includes(c.name));
  const [category, setCategory] = useState(limit?.category || available[0]?.name || "");
  const [amount, setAmount] = useState(limit?.amount ? String(limit.amount) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const amountNum = parseFloat(amount);
    if (!category.trim()) return setError("Pick a category.");
    if (!amountNum || amountNum <= 0) return setError("Enter an amount greater than 0.");
    setSaving(true);
    try {
      if (isEditing) await api.updateLimit(limit.id, { race_id: limit.race_id, category: limit.category, amount: amountNum });
      else await api.createLimit({ race_id: raceId, category: category.trim(), amount: amountNum });
      onSaved();
    } catch (err) {
      setError(err.message || "Couldn't save this limit.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEditing ? "Edit limit" : "Add limit"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="entry-form">
        <label className="field">
          <span>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={isEditing}>
            {isEditing ? (
              <option value={category}>{category}</option>
            ) : (
              available.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))
            )}
          </select>
        </label>
        {!isEditing && available.length === 0 && <p className="field-hint">Every category already has a limit on this race.</p>}
        {isEditing && <p className="field-hint">The category can't be changed — delete this limit and add a new one instead.</p>}

        <label className="field">
          <span>Limit</span>
          <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </label>
        <p className="field-hint">Compared against planned and paid costs in this category for this race.</p>

        {error && <div className="banner banner--error">{error}</div>}

        <button className="btn btn--stamp btn--full" type="submit" disabled={saving || (!isEditing && available.length === 0)}>
          {saving ? "Saving…" : isEditing ? "Save changes" : "Add limit"}
        </button>
      </form>
    </Modal>
  );
}

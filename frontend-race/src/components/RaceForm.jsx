import { useState } from "react";
import { api } from "../api";
import Modal from "./Modal.jsx";

export default function RaceForm({ race, onClose, onSaved }) {
  const isEditing = Boolean(race);
  const [name, setName] = useState(race?.name || "");
  const [type, setType] = useState(race?.type || "");
  const [date, setDate] = useState(race?.date || "");
  const [budget, setBudget] = useState(race?.budget ? String(race.budget) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Give the race a name.");
    const budgetNum = budget === "" ? 0 : parseFloat(budget);
    if (Number.isNaN(budgetNum) || budgetNum < 0) return setError("Budget must be 0 or more.");

    setSaving(true);
    try {
      const payload = { name: name.trim(), type: type.trim(), date, budget: budgetNum };
      const saved = isEditing ? await api.updateRace(race.id, payload) : await api.createRace(payload);
      onSaved(saved);
    } catch (err) {
      setError(err.message || "Couldn't save this race.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEditing ? "Edit race" : "Add race"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="entry-form">
        <label className="field">
          <span>Name</span>
          <input type="text" placeholder="e.g. Cascade 50K" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <div className="field-grid">
          <label className="field">
            <span>Type</span>
            <input type="text" list="race-types" placeholder="Ultra, triathlon…" value={type} onChange={(e) => setType(e.target.value)} />
            <datalist id="race-types">
              {["Ultra", "Marathon", "Half marathon", "Triathlon", "Ironman", "Cycling", "Swim"].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Race date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Total budget</span>
          <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </label>
        <p className="field-hint">What you want the whole race to cost, entry fee through post-race burger.</p>

        {error && <div className="banner banner--error">{error}</div>}

        <button className="btn btn--stamp btn--full" type="submit" disabled={saving}>
          {saving ? "Saving…" : isEditing ? "Save changes" : "Add race"}
        </button>
      </form>
    </Modal>
  );
}

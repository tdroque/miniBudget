import { useState } from "react";
import { api } from "../api";
import { toISODate } from "../dateUtils";
import Modal from "./Modal.jsx";

const NAME_IDEAS = [
  "Entry fee",
  "Gas",
  "Flight",
  "Rental car",
  "Hotel",
  "Parking",
  "Bag check",
  "Meals",
  "Race-day nutrition",
  "Gels & fuel",
  "Gear",
  "Crew / pacer",
];

export default function CostForm({ cost, races, categories, defaultRaceId, onClose, onSaved }) {
  const isEditing = Boolean(cost);
  const linked = Boolean(cost?.transaction_id);
  const [raceId, setRaceId] = useState(String(cost?.race_id ?? defaultRaceId ?? races[0]?.id ?? ""));
  const [name, setName] = useState(cost?.name || "");
  const [amount, setAmount] = useState(cost?.amount ? String(cost.amount) : "");
  const [category, setCategory] = useState(cost?.category || categories[0]?.name || "");
  const [date, setDate] = useState(cost?.date || "");
  const [status, setStatus] = useState(cost?.status || "planned");
  const [note, setNote] = useState(cost?.note || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const amountNum = parseFloat(amount);
    if (!raceId) return setError("Pick a race.");
    if (!name.trim()) return setError("Give this cost a name.");
    if (!amountNum || amountNum <= 0) return setError("Enter an amount greater than 0.");
    if (!category.trim()) return setError("Pick a category — add one in Settings if the list is empty.");

    const finalStatus = linked ? "paid" : status;
    const payload = {
      race_id: Number(raceId),
      name: name.trim(),
      amount: amountNum,
      category: category.trim(),
      date: date || (finalStatus === "paid" ? toISODate(new Date()) : ""),
      status: finalStatus,
      note: note.trim(),
      // Carried along so an offline edit doesn't visually drop the link.
      transaction_id: cost?.transaction_id ?? null,
    };
    setSaving(true);
    try {
      if (isEditing) await api.updateCost(cost.id, payload);
      else await api.createCost(payload);
      onSaved();
    } catch (err) {
      setError(err.message || "Couldn't save this cost.");
    } finally {
      setSaving(false);
    }
  }

  const categoryNames = categories.map((c) => c.name);
  const showMissingCategory = category && !categoryNames.includes(category);

  return (
    <Modal title={isEditing ? "Edit cost" : "Add cost"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="entry-form">
        <label className="field">
          <span>Race</span>
          <select value={raceId} onChange={(e) => setRaceId(e.target.value)}>
            {races.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>What</span>
          <input
            type="text"
            list="cost-name-ideas"
            placeholder="Gas, flight, entry fee…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus={!isEditing}
          />
          <datalist id="cost-name-ideas">
            {NAME_IDEAS.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>

        <div className="field-grid">
          <label className="field">
            <span>Amount</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {categoryNames.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              {showMissingCategory && <option value={category}>{category}</option>}
            </select>
          </label>
        </div>

        <div className="field">
          <span>Status</span>
          <div className="segmented">
            <button
              type="button"
              className={`segmented__btn ${status === "planned" && !linked ? "is-active is-income" : ""}`}
              onClick={() => setStatus("planned")}
              disabled={linked}
            >
              Planned
            </button>
            <button
              type="button"
              className={`segmented__btn ${status === "paid" || linked ? "is-active is-expense" : ""}`}
              onClick={() => setStatus("paid")}
            >
              Paid
            </button>
          </div>
        </div>
        {linked && (
          <p className="field-hint">
            This cost is in Mini Budget, so it stays paid. Changes you save here update that entry too.
          </p>
        )}

        <label className="field">
          <span>Date (optional)</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        <label className="field">
          <span>Notes (optional)</span>
          <textarea rows={2} placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        {error && <div className="banner banner--error">{error}</div>}

        <button className="btn btn--stamp btn--full" type="submit" disabled={saving}>
          {saving ? "Saving…" : isEditing ? "Save changes" : "Add cost"}
        </button>
      </form>
    </Modal>
  );
}

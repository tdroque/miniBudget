import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { toISODate } from "../dateUtils";
import "./EntryForm.css";

export default function EntryForm({ entry, categories, onClose, onSaved }) {
  const isEditing = Boolean(entry);
  const isRecurringEntry = entry?.kind === "recurring";

  const [repeats, setRepeats] = useState(isRecurringEntry);
  const [name, setName] = useState(entry?.name || "");
  const [type, setType] = useState(entry?.type || "expense");
  const [amount, setAmount] = useState(entry?.amount ? String(entry.amount) : "");
  const [category, setCategory] = useState(entry?.category || "");
  const [date, setDate] = useState(entry?.date || entry?.start_date || toISODate(new Date()));
  const [frequency, setFrequency] = useState(entry?.frequency || "monthly");
  const [endDate, setEndDate] = useState(entry?.end_date || "");
  const [description, setDescription] = useState(entry?.description || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Receipt state — only relevant for one-off expense entries.
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [existingReceiptPath, setExistingReceiptPath] = useState(entry?.receipt_path || null);
  const [existingOcrStatus, setExistingOcrStatus] = useState(entry?.ocr_status || "none");
  const [removeExistingReceipt, setRemoveExistingReceipt] = useState(false);
  const fileInputRef = useRef(null);

  const categoryOptions = categories.filter((c) => c.type === type);

  // If the current category isn't valid for the selected type (e.g. user
  // flipped income/expense), clear it so they pick a fresh one.
  useEffect(() => {
    if (category && !categoryOptions.some((c) => c.name === category)) {
      setCategory("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, categories]);

  useEffect(() => {
    return () => {
      if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    };
  }, [receiptPreview]);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    setReceiptFile(file);
    setReceiptPreview(URL.createObjectURL(file));
    setRemoveExistingReceipt(false);
  }

  function handleRemoveReceipt() {
    if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    setReceiptFile(null);
    setReceiptPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (existingReceiptPath) setRemoveExistingReceipt(true);
  }

  const showReceiptSection = type === "expense" && !repeats;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const amountNum = parseFloat(amount);
    if (!name.trim()) return setError("Give this entry a name.");
    if (!amountNum || amountNum <= 0) return setError("Enter an amount greater than 0.");
    if (!category.trim()) return setError("Pick a category — add one in Settings if the list is empty.");

    setSaving(true);
    try {
      let savedTransactionId = isEditing && !isRecurringEntry ? entry.id : null;

      if (repeats) {
        const payload = {
          name: name.trim(),
          amount: amountNum,
          category: category.trim(),
          type,
          frequency,
          start_date: date,
          end_date: endDate || null,
          description,
        };
        if (isEditing && isRecurringEntry) {
          await api.updateRecurring(entry.id, payload);
        } else {
          await api.createRecurring(payload);
        }
      } else {
        const payload = {
          name: name.trim(),
          amount: amountNum,
          category: category.trim(),
          type,
          date,
          description,
        };
        const saved =
          isEditing && !isRecurringEntry
            ? await api.updateTransaction(entry.id, payload)
            : await api.createTransaction(payload);
        savedTransactionId = saved.id;

        if (showReceiptSection && savedTransactionId) {
          if (receiptFile) {
            await api.uploadReceipt(savedTransactionId, receiptFile);
          } else if (removeExistingReceipt && existingReceiptPath) {
            await api.deleteReceipt(savedTransactionId);
          }
        }
      }
      onSaved();
    } catch (err) {
      setError(err.message || "Couldn't save this entry.");
    } finally {
      setSaving(false);
    }
  }

  const currentReceiptSrc = receiptPreview || (!removeExistingReceipt ? api.receiptUrl(existingReceiptPath) : null);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal__header">
          <h2>{isEditing ? "Edit entry" : "Add entry"}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="entry-form">
          <div className="segmented">
            <button
              type="button"
              className={`segmented__btn ${type === "expense" ? "is-active is-expense" : ""}`}
              onClick={() => setType("expense")}
            >
              Expense
            </button>
            <button
              type="button"
              className={`segmented__btn ${type === "income" ? "is-active is-income" : ""}`}
              onClick={() => setType("income")}
            >
              Income
            </button>
          </div>

          <label className="field">
            <span>Name</span>
            <input
              type="text"
              placeholder={type === "income" ? "e.g. Paycheque" : "e.g. Rent"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
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
                <option value="">Select…</option>
                {categoryOptions.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {categoryOptions.length === 0 && (
            <p className="field-hint">
              No {type} categories yet — add one from the Settings tab, then come back here.
            </p>
          )}

          <label className="field">
            <span>{repeats ? "Starts on" : "Date"}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>

          <label className="toggle-row">
            <input type="checkbox" checked={repeats} onChange={(e) => setRepeats(e.target.checked)} />
            <span>This repeats (paycheque, rent, subscription…)</span>
          </label>

          {repeats && (
            <div className="field-grid">
              <label className="field">
                <span>Frequency</span>
                <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              <label className="field">
                <span>Ends on (optional)</span>
                <input type="date" value={endDate || ""} onChange={(e) => setEndDate(e.target.value)} />
              </label>
            </div>
          )}

          {showReceiptSection && (
            <div className="field receipt-field">
              <span>Receipt photo (optional)</span>
              {currentReceiptSrc ? (
                <div className="receipt-preview">
                  <img src={currentReceiptSrc} alt="Receipt preview" />
                  <button type="button" className="receipt-preview__remove" onClick={handleRemoveReceipt}>
                    Remove
                  </button>
                  {isEditing && existingReceiptPath && !receiptFile && !removeExistingReceipt && (
                    <span className={`tag tag--ocr-${existingOcrStatus}`}>
                      {existingOcrStatus === "pending" ? "OCR pending" : existingOcrStatus === "done" ? "OCR done" : existingOcrStatus === "failed" ? "OCR failed" : ""}
                    </span>
                  )}
                </div>
              ) : (
                <label className="receipt-upload-btn">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileChange}
                    hidden
                  />
                  <span>📷 Add a photo of the receipt</span>
                </label>
              )}
              <p className="field-hint">
                Attach a photo now and it's ready for automatic scanning later — nothing is read from it yet.
              </p>
            </div>
          )}

          <label className="field">
            <span>Notes (optional)</span>
            <textarea
              rows={2}
              placeholder="Add a note…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          {error && <div className="banner banner--error">{error}</div>}

          <button className="btn btn--stamp btn--full" type="submit" disabled={saving}>
            {saving ? "Saving…" : isEditing ? "Save changes" : "Add entry"}
          </button>
        </form>
      </div>
    </div>
  );
}

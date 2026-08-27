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
  const [existingOcrText, setExistingOcrText] = useState(entry?.ocr_text || null);
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
    let saveSucceeded = false;
    try {
      const originalKind = isEditing ? (isRecurringEntry ? "recurring" : "transaction") : null;
      const targetKind = repeats ? "recurring" : "transaction";
      // Editing an entry and flipping "this repeats" mid-edit means the kind
      // of record itself has to change (transaction row <-> recurring
      // template) — there's no single API call that does that, so it's a
      // create-the-new-one-then-remove-the-old-one, not a normal update.
      const isConversion = isEditing && originalKind !== targetKind;

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
        saveSucceeded = true;

        if (isConversion) {
          try {
            await api.deleteTransaction(entry.id);
          } catch (deleteErr) {
            onSaved(
              `Saved as recurring, but couldn't remove the original one-off entry — you may want to delete it manually. (${deleteErr.message || "unknown error"})`
            );
            return;
          }
          if (existingReceiptPath) {
            onSaved("Converted to a recurring entry — its receipt was removed, since recurring templates can't have one.");
            return;
          }
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
        saveSucceeded = true;

        if (isConversion) {
          try {
            await api.deleteRecurring(entry.id);
          } catch (deleteErr) {
            onSaved(
              `Saved as a one-off entry, but couldn't remove the original recurring template — you may want to delete it manually. (${deleteErr.message || "unknown error"})`
            );
            return;
          }
        }

        // The entry itself is saved (possibly just queued offline) at this
        // point. A receipt failure — most commonly "you're offline" — is a
        // separate, non-fatal problem: don't let it hide the fact that the
        // entry saved, and don't leave the modal open looking like nothing
        // happened (which would risk a duplicate on resubmit).
        if (showReceiptSection && savedTransactionId > 0) {
          try {
            if (receiptFile) {
              await api.uploadReceipt(savedTransactionId, receiptFile);
            } else if (removeExistingReceipt && existingReceiptPath) {
              await api.deleteReceipt(savedTransactionId);
            }
          } catch (receiptErr) {
            onSaved(receiptErr.message || "Entry saved, but the receipt couldn't be uploaded.");
            return;
          }
        } else if (showReceiptSection && savedTransactionId < 0 && (receiptFile || removeExistingReceipt)) {
          // Offline-created entry — there's no real id to attach a receipt
          // to yet. Let them know instead of silently dropping the photo.
          onSaved(
            "Entry saved and will sync once you're back online — attach the receipt again afterwards, since photos need a live connection."
          );
          return;
        }
      }
      onSaved();
    } catch (err) {
      if (!saveSucceeded) setError(err.message || "Couldn't save this entry.");
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
                  {isEditing && existingReceiptPath && !receiptFile && !removeExistingReceipt && existingOcrStatus !== "none" && (
                    <span className={`tag tag--ocr-${existingOcrStatus}`}>
                      {existingOcrStatus === "pending"
                        ? "Reading receipt…"
                        : existingOcrStatus === "done"
                        ? "Text extracted"
                        : existingOcrStatus === "failed"
                        ? "Couldn't read text"
                        : ""}
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

              {isEditing && !receiptFile && !removeExistingReceipt && existingOcrStatus === "done" && existingOcrText && (
                <details className="ocr-text-details">
                  <summary>Extracted text</summary>
                  <pre className="ocr-text-block">{existingOcrText}</pre>
                </details>
              )}

              {isEditing && !receiptFile && !removeExistingReceipt && existingOcrStatus === "failed" && (
                <p className="field-hint field-hint--warn">
                  Couldn't automatically read text from this receipt — it's still saved as a photo either way.
                </p>
              )}

              <p className="field-hint">
                {receiptFile
                  ? "Text will be pulled off this automatically once it's saved — nothing gets filled in for you yet, but you'll be able to read what it found."
                  : "Attach a photo and Mini Budget automatically reads the text off it. Nothing is filled in for you yet — that's next."}
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

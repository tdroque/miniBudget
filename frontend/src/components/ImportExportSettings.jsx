import { useRef, useState } from "react";
import { api } from "../api";
import { toCSV, parseCSV, downloadCSV } from "../csv.js";
import { validateImportRow } from "../importRows.js";
import { toISODate } from "../dateUtils.js";
import "./ImportExportSettings.css";

const EXPORT_HEADERS = ["kind", "name", "amount", "category", "type", "date", "frequency", "end_date", "description"];

export default function ImportExportSettings({ onChanged }) {
  const fileInputRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function handleExport() {
    setError("");
    setExporting(true);
    try {
      let snapshot;
      try {
        // Prefer a fresh pull from the server (also refreshes the offline
        // cache as a side effect).
        snapshot = await api.bootstrapOfflineCache();
      } catch (err) {
        // Offline — fall back to whatever's in the local cache already.
        snapshot = await api.getCachedSnapshot();
      }

      const rows = [];
      for (const t of snapshot.transactions) {
        rows.push({
          kind: "transaction",
          name: t.name,
          amount: t.amount,
          category: t.category,
          type: t.type,
          date: t.date,
          frequency: "",
          end_date: "",
          description: t.description || "",
        });
      }
      for (const r of snapshot.recurring) {
        rows.push({
          kind: "recurring",
          name: r.name,
          amount: r.amount,
          category: r.category,
          type: r.type,
          date: r.start_date,
          frequency: r.frequency,
          end_date: r.end_date || "",
          description: r.description || "",
        });
      }

      if (rows.length === 0) {
        setError("There's nothing to export yet.");
        return;
      }

      const csv = toCSV(rows, EXPORT_HEADERS);
      downloadCSV(csv, `mini-budget-export-${toISODate(new Date())}.csv`);
    } catch (err) {
      setError(err.message || "Couldn't export your data.");
    } finally {
      setExporting(false);
    }
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setResult(null);
    setImporting(true);

    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length === 0) {
        setError("That file doesn't have any data rows to import.");
        return;
      }

      const skipped = [];
      const newCategories = new Set();
      let imported = 0;

      setProgress({ done: 0, total: rows.length });
      for (let i = 0; i < rows.length; i++) {
        // +2: row 1 is the header, so the first data row is row 2 — matches
        // what the person would see if they opened the file in a spreadsheet.
        const rowNumber = i + 2;
        const validated = validateImportRow(rows[i], rowNumber);
        if (!validated.ok) {
          skipped.push({ row: validated.row, reason: validated.reason });
          setProgress({ done: i + 1, total: rows.length });
          continue;
        }
        try {
          if (validated.kind === "recurring") {
            await api.createRecurring(validated.payload);
          } else {
            await api.createTransaction(validated.payload);
          }
          imported++;
          newCategories.add(`${validated.payload.type}|${validated.payload.category}`);
        } catch (err) {
          skipped.push({ row: rowNumber, reason: err.message || "rejected by the server" });
        }
        setProgress({ done: i + 1, total: rows.length });
      }

      // Best-effort: make sure any category names used by the import show
      // up in the Settings picker too, not just on the imported entries.
      if (newCategories.size > 0) {
        try {
          const existing = await api.getCategories();
          const existingKeys = new Set(existing.map((c) => `${c.type}|${c.name.toLowerCase()}`));
          for (const key of newCategories) {
            const [type, category] = key.split("|");
            if (existingKeys.has(`${type}|${category.toLowerCase()}`)) continue;
            await api.createCategory({ name: category, type }).catch(() => {});
          }
        } catch {
          /* best-effort only — not worth failing the import over */
        }
      }

      setResult({ imported, skipped });
      onChanged?.();
    } catch (err) {
      setError(err.message || "Couldn't read that file.");
    } finally {
      setImporting(false);
      setProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <section className="card">
      <h2 className="section-title">Import &amp; export</h2>
      <p className="text-muted settings-hint">
        Export everything — one-off entries and recurring templates — as a CSV file: a portable backup, or
        something to open in a spreadsheet. Receipt photos aren't included. Import accepts the same format; any row
        missing critical info (name, amount, category, a valid date) is skipped rather than failing the whole
        import, and you'll see exactly which rows and why.
      </p>

      <div className="import-export-actions">
        <button className="btn btn--sm" onClick={handleExport} disabled={exporting}>
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
        <label className={`btn btn--sm btn--ghost import-export-actions__file ${importing ? "is-disabled" : ""}`}>
          {importing ? `Importing… ${progress ? `${progress.done}/${progress.total}` : ""}` : "Import CSV"}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileSelected}
            disabled={importing}
            hidden
          />
        </label>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      {result && (
        <div className={`import-result ${result.skipped.length > 0 ? "import-result--warn" : "import-result--ok"}`}>
          <div className="import-result__summary">
            <p>
              Imported <strong>{result.imported}</strong> {result.imported === 1 ? "entry" : "entries"}
              {result.skipped.length > 0 && (
                <>
                  {" "}
                  · skipped <strong>{result.skipped.length}</strong> row{result.skipped.length === 1 ? "" : "s"}
                </>
              )}
            </p>
            <button className="banner__dismiss" onClick={() => setResult(null)} aria-label="Dismiss">
              ✕
            </button>
          </div>
          {result.skipped.length > 0 && (
            <ul className="import-result__skipped">
              {result.skipped.map((s, i) => (
                <li key={i}>
                  Row {s.row}: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

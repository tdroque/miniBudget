import { useRef, useState } from "react";
import { api } from "../api";
import { toCSV, parseCSV, downloadCSV } from "../csv.js";
import { toISODate } from "../dateUtils.js";
import "./ImportExportSettings.css";

const HEADERS = ["kind", "race", "name", "amount", "category", "status", "date", "note", "budget", "type"];

function toISO(s) {
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

// Same idea as Mini Budget's import: bad rows are skipped (with a reason),
// never fatal. One file holds races, per-race limits and costs, told apart
// by the "kind" column (race | limit | cost; blank means cost).
export default function ImportExport({ onChanged }) {
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
      const d = await api.getData();
      const raceName = (id) => d.races.find((r) => r.id === id)?.name || "";
      const rows = [
        ...d.races.map((r) => ({ kind: "race", race: r.name, date: r.date, budget: r.budget, type: r.type })),
        ...d.limits.map((l) => ({ kind: "limit", race: raceName(l.race_id), amount: l.amount, category: l.category })),
        ...d.costs.map((c) => ({
          kind: "cost",
          race: raceName(c.race_id),
          name: c.name,
          amount: c.amount,
          category: c.category,
          status: c.status,
          date: c.date,
          note: c.note,
        })),
      ];
      downloadCSV(toCSV(rows, HEADERS), `race-budget-${toISODate(new Date())}.csv`);
    } catch (err) {
      setError(err.message || "Couldn't export.");
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
      const rows = parseCSV(await file.text());
      if (rows.length === 0) throw new Error("That file has no rows to import.");

      const d = await api.getData();
      const raceIds = new Map(d.races.map((r) => [r.name.toLowerCase(), r.id]));
      const knownCats = new Set(d.categories.map((c) => c.name.toLowerCase()));
      let imported = 0;
      const skipped = [];

      async function ensureRace(name, row) {
        const key = name.toLowerCase();
        if (raceIds.has(key)) return raceIds.get(key);
        const date = toISO(row.date);
        const created = await api.createRace({
          name,
          type: row.type || "",
          date: date || "",
          budget: parseFloat(row.budget) || 0,
        });
        raceIds.set(key, created.id);
        return created.id;
      }

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const n = i + 2; // row 1 is the header
        const kind = (row.kind || "cost").toLowerCase();
        try {
          if (!row.race) {
            skipped.push({ row: n, reason: "missing race name" });
          } else if (kind === "race") {
            await ensureRace(row.race, row);
            imported++;
          } else if (kind !== "cost" && kind !== "limit") {
            skipped.push({ row: n, reason: `unknown kind “${row.kind}”` });
          } else {
            const amount = parseFloat(String(row.amount || "").replace(/[$,\s]/g, ""));
            const date = toISO(row.date);
            if (!row.category) skipped.push({ row: n, reason: "missing category" });
            else if (Number.isNaN(amount) || amount <= 0) skipped.push({ row: n, reason: "amount must be a number above 0" });
            else if (kind === "cost" && !row.name) skipped.push({ row: n, reason: "missing name" });
            else if (date === null) skipped.push({ row: n, reason: "date must be YYYY-MM-DD" });
            else {
              const raceId = await ensureRace(row.race, {});
              if (kind === "limit") {
                await api.createLimit({ race_id: raceId, category: row.category, amount });
              } else {
                const status = (row.status || "paid").toLowerCase() === "planned" ? "planned" : "paid";
                await api.createCost({
                  race_id: raceId,
                  name: row.name,
                  amount,
                  category: row.category,
                  date: date || "",
                  status,
                  note: row.note || "",
                });
              }
              if (!knownCats.has(row.category.toLowerCase())) {
                knownCats.add(row.category.toLowerCase());
                await api.createCategory({ name: row.category }).catch(() => {});
              }
              imported++;
            }
          }
        } catch (err) {
          skipped.push({ row: n, reason: err.message || "rejected by the server" });
        }
        setProgress({ done: i + 1, total: rows.length });
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
        Export races, limits and costs as one CSV: a portable backup, or something to open in a spreadsheet. Import
        accepts the same format. Rows missing critical info are skipped, and you'll see which and why. Imported costs
        start out unlinked from Mini Budget.
      </p>

      <div className="import-export-actions">
        <button className="btn btn--sm" onClick={handleExport} disabled={exporting}>
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
        <label className={`btn btn--sm btn--ghost import-export-actions__file ${importing ? "is-disabled" : ""}`}>
          {importing ? `Importing… ${progress ? `${progress.done}/${progress.total}` : ""}` : "Import CSV"}
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileSelected} disabled={importing} hidden />
        </label>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      {result && (
        <div className={`import-result ${result.skipped.length > 0 ? "import-result--warn" : "import-result--ok"}`}>
          <div className="import-result__summary">
            <p>
              Imported <strong>{result.imported}</strong> row{result.imported === 1 ? "" : "s"}
              {result.skipped.length > 0 && (
                <>
                  {" "}
                  · skipped <strong>{result.skipped.length}</strong>
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

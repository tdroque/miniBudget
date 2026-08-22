import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { monthRange, yearRange, toISODate } from "./dateUtils";
import NavBar from "./components/NavBar.jsx";
import PeriodPicker from "./components/PeriodPicker.jsx";
import Dashboard from "./components/Dashboard.jsx";
import TransactionList from "./components/TransactionList.jsx";
import RecurringList from "./components/RecurringList.jsx";
import Settings from "./components/Settings.jsx";
import EntryForm from "./components/EntryForm.jsx";
import SyncStatus from "./components/SyncStatus.jsx";
import "./App.css";

const today = new Date();

export default function App() {
  const [tab, setTab] = useState(() => {
    if (typeof window === "undefined") return "dashboard";
    const requested = new URLSearchParams(window.location.search).get("tab");
    return ["dashboard", "transactions", "recurring", "settings"].includes(requested) ? requested : "dashboard";
  });

  const [periodMode, setPeriodMode] = useState("month"); // month | year | custom
  const [year, setYear] = useState(today.getFullYear());
  const [monthIndex, setMonthIndex] = useState(today.getMonth());
  const [customStart, setCustomStart] = useState(toISODate(today));
  const [customEnd, setCustomEnd] = useState(toISODate(today));

  const [categoryFilter, setCategoryFilter] = useState("");
  const [categories, setCategories] = useState([]); // [{id, name, type}]
  const [occurrences, setOccurrences] = useState([]);
  const [summary, setSummary] = useState(null);
  const [recurring, setRecurring] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);

  const range =
    periodMode === "month"
      ? monthRange(year, monthIndex)
      : periodMode === "year"
      ? yearRange(year)
      : { start: customStart, end: customEnd };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [occ, sum, cats, rec] = await Promise.all([
        api.getOccurrences(range.start, range.end, categoryFilter),
        api.getSummary(range.start, range.end),
        api.getCategories(),
        api.getRecurring(),
      ]);
      setOccurrences(occ);
      setSummary(sum);
      setCategories(cats);
      setRecurring(rec);
    } catch (e) {
      setError(e.message || "Something went wrong loading your data.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.start, range.end, categoryFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Warm the offline cache in the background so the app has something to
  // show if the network drops. Best-effort — if this fails (e.g. we're
  // already offline on first load), the app just has nothing cached yet.
  useEffect(() => {
    api.bootstrapOfflineCache().catch(() => {});
  }, []);

  // Desktop PWA shortcuts (right-click the taskbar/dock icon) land here via
  // query params — see the `shortcuts` entries in vite.config.js.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("action") === "add") {
      setEditingEntry(null);
      setFormOpen(true);
    }
    if (params.has("action") || params.has("tab")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Names used for "filter by category" dropdowns — the union of
  // Settings-managed categories and anything already logged (so old
  // entries with a since-deleted category still filter correctly).
  const categoryNames = Array.from(
    new Set([...categories.map((c) => c.name), ...occurrences.map((o) => o.category)])
  ).sort((a, b) => a.localeCompare(b));

  function openAdd() {
    setEditingEntry(null);
    setFormOpen(true);
  }

  function openEditTransaction(occ) {
    if (occ.source_type !== "transaction") return;
    setEditingEntry({
      kind: "transaction",
      id: occ.source_id,
      name: occ.name,
      amount: occ.amount,
      category: occ.category,
      type: occ.type,
      date: occ.date,
      description: occ.description,
      receipt_path: occ.receipt_path || null,
      ocr_status: occ.ocr_status || "none",
    });
    setFormOpen(true);
  }

  function openEditRecurring(item) {
    setEditingEntry({ kind: "recurring", ...item });
    setFormOpen(true);
  }

  async function handleDeleteTransaction(id) {
    await api.deleteTransaction(id);
    refresh();
  }

  async function handleDeleteRecurring(id) {
    await api.deleteRecurring(id);
    refresh();
  }

  async function handleSaved(warning) {
    setFormOpen(false);
    setEditingEntry(null);
    setNotice(warning || "");
    refresh();
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__mark">M</span>
          <h1>Mini Budget</h1>
          <SyncStatus onSynced={refresh} />
        </div>
        <button className="btn btn--stamp" onClick={openAdd}>
          + Add entry
        </button>
      </header>

      <div className="app-body">
        <NavBar tab={tab} onChange={setTab} className="nav-desktop" />

        <main className="app-main">
          {tab !== "settings" && (
            <PeriodPicker
              mode={periodMode}
              year={year}
              monthIndex={monthIndex}
              customStart={customStart}
              customEnd={customEnd}
              onModeChange={setPeriodMode}
              onYearChange={setYear}
              onMonthChange={setMonthIndex}
              onCustomStartChange={setCustomStart}
              onCustomEndChange={setCustomEnd}
            />
          )}

          {error && <div className="banner banner--error">{error}</div>}
          {notice && (
            <div className="banner banner--warning">
              {notice}
              <button className="banner__dismiss" onClick={() => setNotice("")} aria-label="Dismiss">
                ✕
              </button>
            </div>
          )}

          {tab === "dashboard" && (
            <Dashboard
              summary={summary}
              loading={loading}
              categoryFilter={categoryFilter}
              categoryNames={categoryNames}
              onCategoryFilter={setCategoryFilter}
            />
          )}

          {tab === "transactions" && (
            <TransactionList
              occurrences={occurrences}
              loading={loading}
              categoryNames={categoryNames}
              categoryFilter={categoryFilter}
              onCategoryFilter={setCategoryFilter}
              onEdit={openEditTransaction}
              onDelete={handleDeleteTransaction}
            />
          )}

          {tab === "recurring" && (
            <RecurringList
              items={recurring}
              loading={loading}
              onEdit={openEditRecurring}
              onDelete={handleDeleteRecurring}
            />
          )}

          {tab === "settings" && <Settings categories={categories} onChanged={refresh} />}
        </main>
      </div>

      <NavBar tab={tab} onChange={setTab} className="nav-mobile" />

      {formOpen && (
        <EntryForm
          entry={editingEntry}
          categories={categories}
          onClose={() => {
            setFormOpen(false);
            setEditingEntry(null);
          }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

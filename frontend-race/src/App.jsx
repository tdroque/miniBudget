import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { buildView } from "./summary";
import NavBar from "./components/NavBar.jsx";
import Overview from "./components/Overview.jsx";
import Costs from "./components/Costs.jsx";
import CostForm from "./components/CostForm.jsx";
import Races from "./components/Races.jsx";
import RaceForm from "./components/RaceForm.jsx";
import Limits from "./components/Limits.jsx";
import Settings from "./components/Settings.jsx";
import SyncStatus from "./components/SyncStatus.jsx";
import "./App.css";

const TABS = ["overview", "costs", "races", "limits", "settings"];
const EMPTY = { races: [], costs: [], limits: [], categories: [], budget_category: "Races" };
const SCOPE_KEY = "race-budget:scope";

function loadScope() {
  try {
    return localStorage.getItem(SCOPE_KEY) || "all";
  } catch {
    return "all";
  }
}

export default function App() {
  const [tab, setTab] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    return TABS.includes(requested) ? requested : "overview";
  });
  const [scope, setScopeState] = useState(loadScope);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [costForm, setCostForm] = useState(null); // null | { cost?: RaceCost }
  const [raceForm, setRaceForm] = useState(null); // null | { race?: Race }

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api.getData());
    } catch (e) {
      setError(e.message || "Something went wrong loading your data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Warm the offline cache in the background, same as Mini Budget.
  useEffect(() => {
    api.bootstrapOfflineCache().catch(() => {});
  }, []);

  // PWA shortcut: /?action=add
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("action") === "add") setCostForm({});
    if (params.has("action") || params.has("tab")) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // A scope pointing at a race that no longer exists falls back to "all".
  const effectiveScope = scope === "all" || data.races.some((r) => String(r.id) === scope) ? scope : "all";
  const view = useMemo(() => buildView(data, effectiveScope), [data, effectiveScope]);

  function setScope(next) {
    setScopeState(next);
    try {
      localStorage.setItem(SCOPE_KEY, next);
    } catch {
      /* preference just won't persist */
    }
  }

  const categoryNames = useMemo(
    () => Array.from(new Set([...data.categories.map((c) => c.name), ...data.costs.map((c) => c.category)])).sort((a, b) => a.localeCompare(b)),
    [data]
  );

  function openAddCost() {
    if (data.races.length === 0) {
      setRaceForm({});
      return;
    }
    setCostForm({});
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__mark">R</span>
          <h1>Race Budget</h1>
          <SyncStatus onSynced={refresh} />
        </div>
        <button className="btn btn--stamp" onClick={openAddCost}>
          + Add cost
        </button>
      </header>

      <div className="app-body">
        <NavBar tab={tab} onChange={setTab} className="nav-desktop" />

        <main className="app-main">
          {tab !== "settings" && tab !== "races" && data.races.length > 0 && (
            <div className="scope-bar">
              <select value={effectiveScope} onChange={(e) => setScope(e.target.value)} aria-label="Race">
                <option value="all">All races</option>
                {data.races.map((r) => (
                  <option key={r.id} value={String(r.id)}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
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

          {tab === "overview" && (
            <Overview view={view} scope={effectiveScope} loading={loading} hasRaces={data.races.length > 0} onAddRace={() => setRaceForm({})} />
          )}

          {tab === "costs" && (
            <Costs
              costs={view.costs}
              races={data.races}
              showRace={effectiveScope === "all"}
              categoryNames={categoryNames}
              categoryFilter={categoryFilter}
              onCategoryFilter={setCategoryFilter}
              loading={loading}
              budgetCategory={data.budget_category}
              onEdit={(cost) => setCostForm({ cost })}
              onChanged={refresh}
              onNotice={setNotice}
            />
          )}

          {tab === "races" && (
            <Races
              races={data.races}
              costs={data.costs}
              loading={loading}
              onAdd={() => setRaceForm({})}
              onEdit={(race) => setRaceForm({ race })}
              onChanged={refresh}
            />
          )}

          {tab === "limits" && <Limits view={view} scope={effectiveScope} categories={data.categories} loading={loading} onChanged={refresh} />}

          {tab === "settings" && <Settings categories={data.categories} budgetCategory={data.budget_category} onChanged={refresh} />}
        </main>
      </div>

      <NavBar tab={tab} onChange={setTab} className="nav-mobile" />

      {costForm && (
        <CostForm
          key={costForm.cost ? `cost-${costForm.cost.id}` : "new-cost"}
          cost={costForm.cost}
          races={data.races}
          categories={data.categories}
          defaultRaceId={effectiveScope !== "all" ? Number(effectiveScope) : undefined}
          onClose={() => setCostForm(null)}
          onSaved={() => {
            setCostForm(null);
            refresh();
          }}
        />
      )}

      {raceForm && (
        <RaceForm
          key={raceForm.race ? `race-${raceForm.race.id}` : "new-race"}
          race={raceForm.race}
          onClose={() => setRaceForm(null)}
          onSaved={(saved) => {
            const wasNew = !raceForm.race;
            setRaceForm(null);
            if (wasNew && saved?.id) setScope(String(saved.id));
            refresh();
          }}
        />
      )}
    </div>
  );
}

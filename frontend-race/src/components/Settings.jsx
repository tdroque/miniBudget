import { useState } from "react";
import { api } from "../api";
import InstallApp from "./InstallApp.jsx";
import OfflineSyncSettings from "./OfflineSyncSettings.jsx";
import ImportExport from "./ImportExport.jsx";
import "./Settings.css";

export default function Settings({ categories, budgetCategory, onChanged }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  async function handleAdd(e) {
    e.preventDefault();
    setError("");
    const trimmed = name.trim();
    if (!trimmed) return setError("Give the category a name.");
    setSaving(true);
    try {
      await api.createCategory({ name: trimmed });
      setName("");
      onChanged();
    } catch (err) {
      setError(err.message || "Couldn't add that category.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    setDeletingId(id);
    try {
      await api.deleteCategory(id);
      onChanged();
    } catch (err) {
      setError(err.message || "Couldn't delete that category.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="settings">
      <InstallApp />
      <OfflineSyncSettings />
      <ImportExport onChanged={onChanged} />

      <section className="card">
        <h2 className="section-title">Categories</h2>
        <p className="text-muted settings-hint">
          The kinds of cost you can pick when adding one. Deleting a category only removes it from the picker; past
          costs keep theirs.
        </p>
        {categories.length === 0 ? (
          <p className="text-muted">No categories yet.</p>
        ) : (
          <ul className="settings-chips">
            {categories.map((c) => (
              <li key={c.id} className="settings-chip">
                <span>{c.name}</span>
                <button
                  className="settings-chip__remove"
                  onClick={() => handleDelete(c.id)}
                  disabled={deletingId === c.id}
                  aria-label={`Delete ${c.name}`}
                  title="Delete category"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="settings-add-form" onSubmit={handleAdd}>
          <div className="settings-add-form__row">
            <input type="text" placeholder="e.g. Coaching" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn--stamp" type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add"}
            </button>
          </div>
          {error && <div className="banner banner--error">{error}</div>}
        </form>
      </section>

      <section className="card">
        <h2 className="section-title">Mini Budget link</h2>
        <p className="text-muted settings-hint">
          Costs you send to Mini Budget show up there as expenses under the category “{budgetCategory}”. Race costs
          don't appear in Mini Budget until you send them. While a cost is linked, editing or deleting it here updates
          Mini Budget too. To use a different category name, set RACE_BUDGET_CATEGORY on the backend.
        </p>
      </section>
    </div>
  );
}

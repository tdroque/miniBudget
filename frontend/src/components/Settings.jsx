import { useState } from "react";
import { api } from "../api";
import InstallApp from "./InstallApp.jsx";
import OfflineSyncSettings from "./OfflineSyncSettings.jsx";
import ImportExportSettings from "./ImportExportSettings.jsx";
import "./Settings.css";

export default function Settings({ categories, onChanged }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("expense");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const income = categories.filter((c) => c.type === "income");
  const expense = categories.filter((c) => c.type === "expense");

  async function handleAdd(e) {
    e.preventDefault();
    setError("");
    const trimmed = name.trim();
    if (!trimmed) return setError("Give the category a name.");
    setSaving(true);
    try {
      await api.createCategory({ name: trimmed, type });
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

  function CategoryGroup({ title, items, accent }) {
    return (
      <div className="settings-group">
        <h3 className={`settings-group__title settings-group__title--${accent}`}>{title}</h3>
        {items.length === 0 ? (
          <p className="text-muted">No categories yet.</p>
        ) : (
          <ul className="settings-chips">
            {items.map((c) => (
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
      </div>
    );
  }

  return (
    <div className="settings">
      <InstallApp />
      <OfflineSyncSettings />
      <ImportExportSettings onChanged={onChanged} />

      <section className="card">
        <h2 className="section-title">Categories</h2>
        <p className="text-muted settings-hint">
          Manage the categories available when logging entries. Deleting one only removes it from the picker —
          past entries keep their original category.
        </p>

        <CategoryGroup title="Income" items={income} accent="income" />
        <CategoryGroup title="Expense" items={expense} accent="expense" />
      </section>

      <section className="card">
        <h2 className="section-title">Add a category</h2>
        <form className="settings-add-form" onSubmit={handleAdd}>
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
          <div className="settings-add-form__row">
            <input
              type="text"
              placeholder="e.g. Pet care"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="btn btn--stamp" type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add"}
            </button>
          </div>
          {error && <div className="banner banner--error">{error}</div>}
        </form>
      </section>
    </div>
  );
}

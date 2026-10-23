const icon = (d) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d={d} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TABS = [
  { id: "overview", label: "Overview", icon: icon("M4 19V10M12 19V5M20 19v-6") },
  { id: "costs", label: "Costs", icon: icon("M5 6h14M5 12h14M5 18h9") },
  { id: "races", label: "Races", icon: icon("M6 21V4M6 5h11l-2 4 2 4H6") },
  {
    id: "limits",
    label: "Limits",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function NavBar({ tab, onChange, className }) {
  return (
    <nav className={className}>
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`nav-item ${tab === t.id ? "active" : ""}`}
          onClick={() => onChange(t.id)}
          aria-current={tab === t.id ? "page" : undefined}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

export default function DashboardSkeleton() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--off-white)" }}>
      <div style={{ height: 68, background: "var(--navy-dark)" }} />
      <div className="skeleton-shell">
        <div className="skeleton" style={{ width: 220, height: 22 }} />
        <div className="skeleton-row">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 90, flex: 1 }} />
          ))}
        </div>
        <div className="skeleton-row">
          <div className="skeleton" style={{ height: 220, flex: 2 }} />
          <div className="skeleton" style={{ height: 220, flex: 1 }} />
        </div>
      </div>
    </div>
  );
}

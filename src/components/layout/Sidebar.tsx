"use client";

import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { SIDEBAR_SECTIONS } from "@/lib/constants";
import { isAdminRole } from "@/lib/constants";
import type { SectionId } from "@/lib/types";

export default function Sidebar({
  active,
  onSelect,
}: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
}) {
  const { currentUser, hasPermission } = useApp();
  const [query, setQuery] = useState("");

  const isAdmin = currentUser ? isAdminRole(currentUser.role) : false;

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SIDEBAR_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.requiresAdmin && !isAdmin) return false;
        if (item.permission && !isAdmin && !hasPermission(item.permission)) return false;
        if (q && !item.label.toLowerCase().includes(q)) return false;
        return true;
      }),
    })).filter((section) => section.items.length > 0);
  }, [query, isAdmin, hasPermission]);

  return (
    <nav className="sidebar">
      <div className="sidebar-search">
        <div className="sidebar-search-wrap">
          <span className="s-icon">🔍</span>
          <input
            type="text"
            placeholder="Search menu…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {sections.map((section) => (
        <div className="sidebar-section" key={section.label}>
          <div className="sidebar-section-label">{section.label}</div>
          {section.items.map((item) => (
            <button
              key={item.id}
              className={`tab-btn ${active === item.id ? "active" : ""}`}
              onClick={() => onSelect(item.id as SectionId)}
            >
              <span className="tab-icon">{item.icon}</span> {item.label}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

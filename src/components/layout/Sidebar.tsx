"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "@/lib/store";
import { SIDEBAR_SECTIONS, isAdminRole } from "@/lib/constants";
import { Icon } from "@/lib/icon-map";
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
          <Icon name="search" size={13} className="s-icon" />
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
          {section.items.map((item) => {
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                className={`tab-btn ${isActive ? "active" : ""}`}
                onClick={() => onSelect(item.id as SectionId)}
              >
                {isActive && (
                  <motion.span
                    layoutId="sidebar-active-indicator"
                    className="tab-active-dot"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <span className="tab-icon">
                  <Icon name={item.icon} size={16} />
                </span>
                {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

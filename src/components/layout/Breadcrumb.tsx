"use client";

import { SECTION_LABELS } from "@/lib/constants";
import type { SectionId } from "@/lib/types";

export default function Breadcrumb({ active }: { active: SectionId }) {
  const label = SECTION_LABELS[active] || "Dashboard";
  return (
    <div className="breadcrumb">
      <span className="breadcrumb-home">TDIS</span>
      <span className="breadcrumb-sep">/</span>
      <span className="breadcrumb-current">{label}</span>
    </div>
  );
}

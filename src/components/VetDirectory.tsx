"use client";

import { useMemo, useState } from "react";
import type { VetListing } from "@/data/types";
import { VetCard } from "@/components/VetCard";
import { vetPath } from "@/lib/paths";

type Filter = "all" | "emergency" | "urgent" | "general";

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "emergency", label: "24/7" },
  { id: "urgent", label: "Urgent" },
  { id: "general", label: "General" },
];

function matches(vet: VetListing, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "emergency")
    return vet.is24_7 || vet.careType === "24/7 Emergency";
  if (filter === "urgent") return vet.careType === "Urgent Care";
  return vet.careType === "General Practice" || vet.careType === "Specialty";
}

export function VetDirectory({
  vets,
  stateSlug,
  citySlug,
}: {
  vets: VetListing[];
  stateSlug: string;
  citySlug: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(
    () => vets.filter((vet) => matches(vet, filter)),
    [vets, filter],
  );

  return (
    <div className="directory">
      <div className="directory-controls">
        <div
          className="filter-row"
          role="tablist"
          aria-label="Filter by care type"
        >
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={
                filter === item.id ? "filter-chip active" : "filter-chip"
              }
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <p className="directory-count">
        Showing {visible.length} of {vets.length} clinics
      </p>

      <div className="vet-grid">
        {visible.map((vet) => (
          <VetCard
            key={vet.slug}
            vet={vet}
            href={vetPath(stateSlug, citySlug, vet.slug)}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="empty-state">
          No clinics match that filter. Try another care type.
        </p>
      ) : null}
    </div>
  );
}

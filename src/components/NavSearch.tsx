"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import californiaCities from "@/data/cities/california.json";
import type { CityRecord } from "@/data/types";
import { cityPath } from "@/lib/paths";

const cities = californiaCities as CityRecord[];

function matches(city: CityRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    city.name.toLowerCase().includes(q) ||
    city.county.toLowerCase().includes(q) ||
    city.slug.includes(q.replace(/\s+/g, "-"))
  );
}

export function NavSearch({
  id = "nav-city-search",
  placeholder = "Search a California city…",
  className,
}: {
  id?: string;
  placeholder?: string;
  className?: string;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const q = query.trim();
    if (q.length < 1) return [];
    return cities
      .filter((city) => matches(city, q))
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "live" ? -1 : 1;
        const aStarts = a.name.toLowerCase().startsWith(q.toLowerCase())
          ? 0
          : 1;
        const bStarts = b.name.toLowerCase().startsWith(q.toLowerCase())
          ? 0
          : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return b.population - a.population;
      })
      .slice(0, 8);
  }, [query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function goToCity(city: CityRecord) {
    setQuery(city.name);
    setOpen(false);
    router.push(cityPath(city.stateSlug || "ca", city.slug));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (results[active]) {
      goToCity(results[active]);
      return;
    }
    const q = query.trim();
    if (!q) return;
    router.push(`/ca?q=${encodeURIComponent(q)}`);
    setOpen(false);
  }

  return (
    <div className={className ? `nav-search ${className}` : "nav-search"} ref={rootRef}>
      <form onSubmit={onSubmit} role="search">
        <label className="sr-only" htmlFor={id}>
          Search cities
        </label>
        <input
          id={id}
          type="search"
          placeholder={placeholder}
          value={query}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!open || results.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % results.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i - 1 + results.length) % results.length);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </form>

      {open && results.length > 0 ? (
        <ul className="nav-search-results" role="listbox">
          {results.map((city, index) => (
            <li key={city.slug} role="option" aria-selected={index === active}>
              <button
                type="button"
                className={
                  index === active
                    ? "nav-search-option active"
                    : "nav-search-option"
                }
                onMouseEnter={() => setActive(index)}
                onClick={() => goToCity(city)}
              >
                <span className="nav-search-option-name">{city.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

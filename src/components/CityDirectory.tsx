import Link from "next/link";
import type { CityRecord } from "@/data/types";
import { cityPath } from "@/lib/paths";

export function CityDirectory({
  cities,
  stateSlug,
}: {
  cities: CityRecord[];
  stateSlug: string;
}) {
  const sorted = [...cities].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="directory">
      <section className="city-group">
        <h2 className="city-group-title">Cities</h2>
        <div className="city-name-grid">
          {sorted.map((city) => (
            <Link
              key={city.slug}
              href={cityPath(stateSlug, city.slug)}
              className="city-name-link"
            >
              {city.name}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

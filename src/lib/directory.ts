import "server-only";

import fs from "node:fs";
import path from "node:path";
import californiaCities from "@/data/cities/california.json";
import { santaBarbaraVets } from "@/data/santa-barbara";
import type { CityRecord, StateRecord, VetListing } from "@/data/types";
import { hasWebsite } from "@/lib/vets";

const citiesByState: Record<string, CityRecord[]> = {
  ca: californiaCities as CityRecord[],
};

const curatedVets: Record<string, VetListing[]> = {
  "ca/santa-barbara": santaBarbaraVets,
};

function readEnrichedVets(
  stateSlug: string,
  citySlug: string,
): VetListing[] {
  const file = path.join(
    process.cwd(),
    "src/data/vets",
    stateSlug,
    `${citySlug}.json`,
  );
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as VetListing[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function prioritizeVets(vets: VetListing[]): VetListing[] {
  return [...vets]
    .filter(hasWebsite)
    .map((vet) => {
      const is24 = Boolean(vet.is24_7 || vet.careType === "24/7 Emergency");
      let careType = vet.careType;
      if (is24 && careType === "General Practice") {
        careType = "24/7 Emergency";
      }
      let shortName = vet.shortName;
      if (
        !shortName &&
        (is24 || careType === "Urgent Care" || careType === "24/7 Emergency")
      ) {
        const cleaned = vet.name
          .replace(
            /\b(animal|veterinary|veterinarian|pet|hospital|clinic|center|centre|specialty|and|emergency|urgent|care|of|the)\b/gi,
            " ",
          )
          .replace(/\s+/g, " ")
          .trim();
        const parts = cleaned.split(" ").filter(Boolean);
        shortName =
          parts.slice(0, 2).join(" ").slice(0, 22) ||
          vet.name.split(/\s+/).slice(0, 2).join(" ");
      }
      return {
        ...vet,
        careType,
        is24_7: is24 || vet.is24_7,
        shortName,
        reviews: vet.reviews || [],
      };
    })
    .sort((a, b) => {
      const score = (v: VetListing) =>
        (v.is24_7 || v.careType === "24/7 Emergency" ? 1000 : 0) +
        (v.careType === "Urgent Care" ? 400 : 0) +
        (v.careType === "Specialty" ? 200 : 0) +
        (100 - Math.min(v.priority || 99, 99)) +
        v.rating * 10;
      return score(b) - score(a) || a.name.localeCompare(b.name);
    })
    .map((vet, index) => ({ ...vet, priority: index + 1 }));
}

export function getState(stateSlug: string): StateRecord | undefined {
  const cities = getCities(stateSlug);
  if (!cities.length) return undefined;
  const liveCityCount = cities.filter((c) => c.status === "live").length;
  return {
    name: stateSlug === "ca" ? "California" : stateSlug.toUpperCase(),
    slug: stateSlug,
    abbreviation: stateSlug === "ca" ? "CA" : stateSlug.toUpperCase(),
    cityCount: cities.length,
    liveCityCount,
  };
}

export function getStates(): StateRecord[] {
  return Object.keys(citiesByState)
    .map((slug) => getState(slug)!)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getCities(stateSlug: string): CityRecord[] {
  return [...(citiesByState[stateSlug] ?? [])]
    .map((city) => ({
      ...city,
      status: (getVetsForCity(stateSlug, city.slug).length > 0
        ? "live"
        : "pending") as CityRecord["status"],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getCity(
  stateSlug: string,
  citySlug: string,
): CityRecord | undefined {
  const city = citiesByState[stateSlug]?.find((c) => c.slug === citySlug);
  if (!city) return undefined;
  return {
    ...city,
    status: getVetsForCity(stateSlug, citySlug).length > 0 ? "live" : "pending",
  };
}

export function getVetsForCity(
  stateSlug: string,
  citySlug: string,
): VetListing[] {
  const key = `${stateSlug}/${citySlug}`;
  const curated = curatedVets[key];
  const raw = curated?.length ? curated : readEnrichedVets(stateSlug, citySlug);
  return prioritizeVets(raw);
}

export function getVet(
  stateSlug: string,
  citySlug: string,
  vetSlug: string,
): VetListing | undefined {
  return getVetsForCity(stateSlug, citySlug).find((v) => v.slug === vetSlug);
}

export function defaultCityDescription(city: CityRecord): string {
  return (
    city.description ??
    `Find dog vets, 24/7 emergency hospitals, and urgent care in ${city.name}, ${city.state}. Emergency care is shown first.`
  );
}

export function cityHasListings(stateSlug: string, citySlug: string): boolean {
  return getVetsForCity(stateSlug, citySlug).length > 0;
}

export function getClinicCount(stateSlug: string): number {
  return getCities(stateSlug)
    .filter((c) => c.status === "live")
    .reduce(
      (sum, city) => sum + getVetsForCity(stateSlug, city.slug).length,
      0,
    );
}

export { cityPath, vetPath } from "@/lib/paths";

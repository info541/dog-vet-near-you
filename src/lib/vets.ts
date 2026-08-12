import type { VetListing } from "@/data/types";

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function mapsHref(vet: VetListing): string {
  const q = encodeURIComponent(
    `${vet.address}, ${vet.city}, ${vet.state} ${vet.zip}`,
  );
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function fullAddress(vet: VetListing): string {
  return `${vet.address}, ${vet.city}, ${vet.state} ${vet.zip}`;
}

/** Only clinics with a real public website should appear in the directory. */
export function hasWebsite(vet: Pick<VetListing, "website">): boolean {
  const website = (vet.website || "").trim();
  if (!website) return false;
  const normalized = website.toLowerCase();
  if (
    normalized === "#" ||
    normalized === "n/a" ||
    normalized === "na" ||
    normalized === "none" ||
    normalized === "null"
  ) {
    return false;
  }
  return /^https?:\/\//i.test(website) || /^[\w.-]+\.[a-z]{2,}/i.test(website);
}

export function websiteHref(website: string): string {
  const value = website.trim();
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

export function careBadgeClass(careType: VetListing["careType"]): string {
  switch (careType) {
    case "24/7 Emergency":
      return "badge-emergency";
    case "Urgent Care":
      return "badge-urgent";
    case "Specialty":
      return "badge-specialty";
    default:
      return "badge-general";
  }
}

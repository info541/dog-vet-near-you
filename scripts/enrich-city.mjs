/**
 * Enrich a California city with veterinary clinics via Google Places API (New).
 *
 * Setup:
 *   export GOOGLE_PLACES_API_KEY=your_key
 *
 * Usage:
 *   npm run enrich -- --state ca --city los-angeles
 *   npm run enrich -- --state ca --city sacramento --limit 20
 *   npm run enrich -- --state ca --all-pending --limit-cities 5
 *
 * Writes:
 *   src/data/vets/ca/{city}.json
 *   updates city status to "live" in california.json
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const CITIES_PATH = path.join(ROOT, "src/data/cities/california.json");
const VETS_DIR = path.join(ROOT, "src/data/vets");

function parseArgs(argv) {
  const args = { state: "ca", city: null, limit: 25, allPending: false, limitCities: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--state") args.state = argv[++i];
    else if (a === "--city") args.city = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--all-pending") args.allPending = true;
    else if (a === "--limit-cities") args.limitCities = Number(argv[++i]);
  }
  return args;
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function inferCareType(place) {
  const text = `${place.displayName?.text ?? ""} ${(place.types || []).join(" ")} ${(place.editorialSummary?.text ?? "")}`.toLowerCase();
  const hours = JSON.stringify(place.regularOpeningHours ?? {}).toLowerCase();
  const is24 =
    hours.includes("24 hour") ||
    hours.includes("open 24") ||
    (place.regularOpeningHours?.periods || []).length >= 7 &&
      (place.regularOpeningHours?.periods || []).every(
        (p) => p.open?.hour === 0 && (!p.close || (p.close.hour === 0 && p.close.minute === 0)),
      );
  if (
    text.includes("emergency") ||
    text.includes("critical care") ||
    text.includes("specialty and emergency")
  ) {
    return { careType: is24 || text.includes("24") ? "24/7 Emergency" : "Urgent Care", is24_7: Boolean(is24 || text.includes("24/7") || text.includes("24 hour")) };
  }
  if (text.includes("urgent")) {
    return { careType: "Urgent Care", is24_7: false };
  }
  if (text.includes("specialty") || text.includes("specialist")) {
    return { careType: "Specialty", is24_7: false };
  }
  return { careType: "General Practice", is24_7: Boolean(is24) };
}

function formatHours(place) {
  const weekday = place.regularOpeningHours?.weekdayDescriptions;
  if (weekday?.length) {
    return {
      hours: weekday.join("; "),
      hoursDetail: weekday,
    };
  }
  return { hours: "Call for hours", hoursDetail: ["Call the clinic for current hours"] };
}

function mapPlace(place, cityName, stateAbbr, priority) {
  const { careType, is24_7 } = inferCareType(place);
  const { hours, hoursDetail } = formatHours(place);
  const name = place.displayName?.text || "Veterinary Clinic";
  const address = place.shortFormattedAddress || place.formattedAddress || "";
  const zipMatch = (place.formattedAddress || "").match(/\b(\d{5})(?:-\d{4})?\b/);
  const reviews = (place.reviews || []).slice(0, 3).map((r) => ({
    author: r.authorAttribution?.displayName || "Pet parent",
    rating: r.rating || 5,
    text: r.text?.text || r.originalText?.text || "Great care for our dog.",
    source: "Google",
    date: r.relativePublishTimeDescription,
  }));

  return {
    slug: slugify(name),
    name,
    careType,
    is24_7,
    priority,
    description:
      place.editorialSummary?.text ||
      `${name} provides veterinary care for dogs in ${cityName}, ${stateAbbr}. Contact the clinic for appointments, urgent needs, and current services.`,
    phone: place.nationalPhoneNumber || place.internationalPhoneNumber || "Call for number",
    website: place.websiteUri || "",
    address: address.split(",")[0] || address,
    city: cityName,
    state: stateAbbr,
    zip: zipMatch?.[1] || "",
    hours,
    hoursDetail,
    rating: place.rating || 0,
    reviewCount: place.userRatingCount || reviews.length,
    services: [
      "Dog Care",
      careType,
      ...(is24_7 ? ["24/7 Availability"] : []),
      "Veterinary Medicine",
    ],
    highlights: [
      ...(is24_7 ? ["Open 24/7"] : []),
      place.rating ? `${place.rating.toFixed(1)} Google rating` : "Local veterinary clinic",
      `${cityName} dog care`,
    ],
    acceptsDogs: true,
    reviews,
    placeId: place.id,
    sourceUpdatedAt: new Date().toISOString(),
  };
}

async function placesSearch(apiKey, cityName) {
  const url = "https://places.googleapis.com/v1/places:searchText";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.regularOpeningHours,places.types,places.editorialSummary,places.reviews",
    },
    body: JSON.stringify({
      textQuery: `veterinary clinic dog hospital emergency in ${cityName}, California`,
      includedType: "veterinary_care",
      pageSize: 20,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Places search failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.places || [];
}

function prioritize(vets) {
  return vets
    .map((v) => ({
      ...v,
      _score:
        (v.is24_7 ? 1000 : 0) +
        (v.careType === "24/7 Emergency" ? 800 : 0) +
        (v.careType === "Urgent Care" ? 400 : 0) +
        (v.careType === "Specialty" ? 200 : 0) +
        v.rating * 10 +
        Math.min(v.reviewCount, 200) / 20,
    }))
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...v }, i) => ({ ...v, priority: i + 1 }));
}

async function enrichCity(city, apiKey, limit) {
  console.log(`\n→ Enriching ${city.name}, CA…`);
  const places = await placesSearch(apiKey, city.name);
  const mapped = places.slice(0, limit).map((p, i) =>
    mapPlace(p, city.name, "CA", i + 1),
  );
  // dedupe by slug
  const seen = new Set();
  const unique = [];
  for (const v of mapped) {
    let slug = v.slug;
    let n = 2;
    while (seen.has(slug)) {
      slug = `${v.slug}-${n++}`;
    }
    seen.add(slug);
    unique.push({ ...v, slug });
  }
  const vets = prioritize(unique);
  const outDir = path.join(VETS_DIR, "ca");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${city.slug}.json`);
  fs.writeFileSync(outFile, JSON.stringify(vets, null, 2) + "\n");
  console.log(`  Wrote ${vets.length} clinics → ${path.relative(ROOT, outFile)}`);
  return vets.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error("Missing GOOGLE_PLACES_API_KEY");
    process.exit(1);
  }

  const cities = JSON.parse(fs.readFileSync(CITIES_PATH, "utf8"));
  let targets = [];
  if (args.city) {
    const city = cities.find((c) => c.slug === args.city);
    if (!city) {
      console.error(`City not found: ${args.city}`);
      process.exit(1);
    }
    targets = [city];
  } else if (args.allPending) {
    targets = cities
      .filter((c) => c.status !== "live")
      .sort((a, b) => b.population - a.population)
      .slice(0, args.limitCities);
  } else {
    console.error("Pass --city <slug> or --all-pending");
    process.exit(1);
  }

  let updated = 0;
  for (const city of targets) {
    const count = await enrichCity(city, apiKey, args.limit);
    if (count > 0) {
      city.status = "live";
      city.tagline =
        city.tagline ||
        `Dog vets and emergency care in ${city.name}, California`;
      city.description =
        city.description ||
        `Veterinary clinics, urgent care, and dog-health resources in ${city.name} — prioritized so you can find emergency care first.`;
      updated++;
    }
    // gentle rate limit
    await new Promise((r) => setTimeout(r, 400));
  }

  fs.writeFileSync(CITIES_PATH, JSON.stringify(cities, null, 2) + "\n");
  console.log(`\nDone. Marked ${updated} cities live.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

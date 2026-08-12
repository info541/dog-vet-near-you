/**
 * Backfill Google ratings + review samples onto existing OSM clinic JSON.
 *
 * Easy parts: scripted walk + merge into current files.
 * Harder parts: needs GOOGLE_PLACES_API_KEY + billing; Google only returns a
 * small review sample (not every review); name/address matching isn't perfect.
 *
 * Setup:
 *   export GOOGLE_PLACES_API_KEY=your_key
 *
 * Usage:
 *   npm run enrich:reviews -- --city santa-monica
 *   npm run enrich:reviews -- --city los-angeles --limit 10
 *   npm run enrich:reviews -- --all --limit 50
 *   npm run enrich:reviews -- --all --skip-enriched
 *   npm run enrich:reviews -- --city pasadena --dry-run
 *
 * Notes:
 *   - Reuses matches across cities (same clinic shared nearby).
 *   - Does not replace clinic identity fields from OSM unless empty.
 *   - Google typically returns ~5 review texts max per place.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const VETS_DIR = path.join(ROOT, "src/data/vets/ca");
const CACHE_PATH = path.join(ROOT, "scripts/.places-review-cache.json");

function parseArgs(argv) {
  const args = {
    city: null,
    all: false,
    limit: Infinity,
    delayMs: 350,
    dryRun: false,
    skipEnriched: true,
    force: false,
    maxReviews: 5,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--city") args.city = argv[++i];
    else if (a === "--all") args.all = true;
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--delay-ms") args.delayMs = Number(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--skip-enriched") args.skipEnriched = true;
    else if (a === "--no-skip-enriched") args.skipEnriched = false;
    else if (a === "--force") {
      args.force = true;
      args.skipEnriched = false;
    } else if (a === "--max-reviews") args.maxReviews = Number(argv[++i]);
  }
  return args;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) return { byQuery: {}, byPlaceId: {} };
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return { byQuery: {}, byPlaceId: {} };
  }
}

function saveCache(cache) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + "\n");
}

function digits(phone) {
  return String(phone || "").replace(/\D/g, "").replace(/^1(?=\d{10})/, "");
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|llc|hospital|clinic|center|centre|animal|pet|veterinary|vet|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryKey(vet) {
  return [
    normalizeName(vet.name),
    String(vet.address || "").toLowerCase().trim(),
    vet.city,
    digits(vet.phone),
  ].join("|");
}

function alreadyEnriched(vet) {
  if (vet.placeId && Number(vet.reviewCount) > 0 && Number(vet.rating) > 0) {
    const googleReviews = (vet.reviews || []).filter((r) => r.source === "Google");
    return googleReviews.length > 0 || Number(vet.reviewCount) > 0;
  }
  return false;
}

function mapReviews(place, maxReviews) {
  return (place.reviews || []).slice(0, maxReviews).map((r) => ({
    author: r.authorAttribution?.displayName || "Pet parent",
    rating: r.rating || 5,
    text: r.text?.text || r.originalText?.text || "",
    source: "Google",
    date: r.relativePublishTimeDescription,
  })).filter((r) => r.text);
}

function mergePlaceIntoVet(vet, place, maxReviews) {
  const reviews = mapReviews(place, maxReviews);
  const rating = place.rating ?? vet.rating;
  const reviewCount = place.userRatingCount ?? vet.reviewCount ?? reviews.length;
  const phone =
    place.nationalPhoneNumber ||
    place.internationalPhoneNumber ||
    vet.phone;
  const website = place.websiteUri || vet.website;
  const hoursDetail = place.regularOpeningHours?.weekdayDescriptions;

  const highlights = [...(vet.highlights || [])].filter(
    (h) => !/google rating/i.test(h) && h !== "Sourced from OpenStreetMap",
  );
  if (rating) {
    highlights.unshift(`${Number(rating).toFixed(1)} Google rating`);
  }

  return {
    ...vet,
    phone: phone || vet.phone,
    website: website || vet.website,
    hours: hoursDetail?.length ? hoursDetail.join("; ") : vet.hours,
    hoursDetail: hoursDetail?.length ? hoursDetail : vet.hoursDetail,
    rating: rating || vet.rating || 0,
    reviewCount: reviewCount || 0,
    highlights,
    reviews: reviews.length ? reviews : (vet.reviews || []).filter((r) => r.source !== "OpenStreetMap"),
    placeId: place.id || vet.placeId,
    sourceUpdatedAt: new Date().toISOString(),
  };
}

async function searchPlace(apiKey, vet) {
  const textQuery = [
    vet.name,
    "veterinary",
    vet.address,
    vet.city,
    "CA",
    vet.zip,
  ]
    .filter(Boolean)
    .join(" ");

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.regularOpeningHours,places.reviews,places.types",
    },
    body: JSON.stringify({
      textQuery,
      includedType: "veterinary_care",
      pageSize: 5,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`searchText ${res.status}: ${body}`);
  }

  const data = await res.json();
  const places = data.places || [];
  if (!places.length) return null;

  const wantName = normalizeName(vet.name);
  const wantPhone = digits(vet.phone);
  let best = places[0];
  let bestScore = -1;

  for (const place of places) {
    let score = 0;
    const gotName = normalizeName(place.displayName?.text);
    if (gotName && wantName && (gotName.includes(wantName) || wantName.includes(gotName))) {
      score += 5;
    }
    const gotPhone = digits(place.nationalPhoneNumber || place.internationalPhoneNumber);
    if (wantPhone && gotPhone && wantPhone === gotPhone) score += 8;
    if ((place.types || []).includes("veterinary_care")) score += 2;
    if (place.rating) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = place;
    }
  }

  // Reject very weak matches
  if (bestScore < 2) return null;
  return best;
}

async function getPlaceDetails(apiKey, placeId) {
  const id = encodeURIComponent(placeId);
  const res = await fetch(`https://places.googleapis.com/v1/places/${id}`, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,rating,userRatingCount,regularOpeningHours,reviews,types",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`place details ${res.status}: ${body}`);
  }
  return res.json();
}

function listCityFiles(citySlug) {
  if (citySlug) {
    const file = path.join(VETS_DIR, `${citySlug}.json`);
    if (!fs.existsSync(file)) {
      throw new Error(`No vet file for city: ${citySlug}`);
    }
    return [file];
  }
  return fs
    .readdirSync(VETS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(VETS_DIR, f))
    .sort();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.city && !args.all) {
    console.error("Pass --city <slug> or --all");
    process.exit(1);
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey && !args.dryRun) {
    console.error("Missing GOOGLE_PLACES_API_KEY");
    process.exit(1);
  }

  const files = listCityFiles(args.city);
  const cache = loadCache();

  let considered = 0;
  let skipped = 0;
  let matched = 0;
  let unmatched = 0;
  let updated = 0;
  let apiCalls = 0;
  let errors = 0;

  console.log(
    `Review enrich: ${files.length} city file(s), limit=${args.limit}, dryRun=${args.dryRun}, skipEnriched=${args.skipEnriched}`,
  );

  outer: for (const file of files) {
    const citySlug = path.basename(file, ".json");
    const vets = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(vets) || !vets.length) continue;

    let fileChanged = false;

    for (let i = 0; i < vets.length; i++) {
      if (considered >= args.limit) break outer;
      const vet = vets[i];
      considered++;

      if (args.skipEnriched && alreadyEnriched(vet) && !args.force) {
        skipped++;
        continue;
      }

      const key = queryKey(vet);
      let place = null;

      if (vet.placeId && cache.byPlaceId[vet.placeId]) {
        place = cache.byPlaceId[vet.placeId];
      } else if (cache.byQuery[key]?.place) {
        place = cache.byQuery[key].place;
      } else if (cache.byQuery[key]?.miss) {
        unmatched++;
        continue;
      } else if (!args.dryRun) {
        try {
          place = await searchPlace(apiKey, vet);
          apiCalls++;
          await sleep(args.delayMs);

          // Optional details refresh when search omitted reviews
          if (place?.id && (!place.reviews || place.reviews.length === 0)) {
            const details = await getPlaceDetails(apiKey, place.id);
            apiCalls++;
            place = { ...place, ...details };
            await sleep(args.delayMs);
          }

          if (place?.id) {
            cache.byQuery[key] = { placeId: place.id, place };
            cache.byPlaceId[place.id] = place;
          } else {
            cache.byQuery[key] = { miss: true };
          }
        } catch (err) {
          errors++;
          console.error(`  ! ${citySlug}/${vet.slug}: ${err.message}`);
          await sleep(args.delayMs * 2);
          continue;
        }
      }

      if (!place) {
        unmatched++;
        console.log(`  · no match  ${citySlug} · ${vet.name}`);
        continue;
      }

      matched++;
      const next = mergePlaceIntoVet(vet, place, args.maxReviews);
      const changed =
        next.placeId !== vet.placeId ||
        next.rating !== vet.rating ||
        next.reviewCount !== vet.reviewCount ||
        JSON.stringify(next.reviews) !== JSON.stringify(vet.reviews);

      if (changed) {
        vets[i] = next;
        fileChanged = true;
        updated++;
        console.log(
          `  ✓ ${citySlug} · ${vet.name} → ${next.rating}★ (${next.reviewCount}) · ${(next.reviews || []).length} texts`,
        );
      } else {
        skipped++;
      }
    }

    if (fileChanged && !args.dryRun) {
      fs.writeFileSync(file, JSON.stringify(vets, null, 2) + "\n");
    }

    if (!args.dryRun && apiCalls && apiCalls % 25 === 0) {
      saveCache(cache);
    }
  }

  if (!args.dryRun) saveCache(cache);

  console.log("\nDone");
  console.log(`  Considered: ${considered}`);
  console.log(`  Matched:    ${matched}`);
  console.log(`  Updated:    ${updated}`);
  console.log(`  Unmatched:  ${unmatched}`);
  console.log(`  Skipped:    ${skipped}`);
  console.log(`  API calls:  ${apiCalls}`);
  console.log(`  Errors:     ${errors}`);
  if (args.dryRun) console.log("  (dry run — no files written)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

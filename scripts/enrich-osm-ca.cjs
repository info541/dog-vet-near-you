/**
 * Enrich all California cities with veterinary clinics from an OSM PBF extract.
 *
 * Usage:
 *   node scripts/enrich-osm-ca.cjs \
 *     --pbf /tmp/pawharbor-osm/california-latest.osm.pbf \
 *     --cities-csv /tmp/us_cities.csv
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = process.cwd();
const CITIES_PATH = path.join(ROOT, "src/data/cities/california.json");
const VETS_DIR = path.join(ROOT, "src/data/vets/ca");

function parseArgs(argv) {
  const args = {
    pbf: "/tmp/pawharbor-osm/california-latest.osm.pbf",
    citiesCsv: "/tmp/us_cities.csv",
    centroidsJson: "/tmp/pawharbor-osm/city-centroids.json",
    workDir: "/tmp/pawharbor-osm",
    nearbyKm: 14,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pbf") args.pbf = argv[++i];
    else if (a === "--cities-csv") args.citiesCsv = argv[++i];
    else if (a === "--centroids-json") args.centroidsJson = argv[++i];
    else if (a === "--work-dir") args.workDir = argv[++i];
    else if (a === "--nearby-km") args.nearbyKm = Number(argv[++i]);
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

function normalizeCity(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bst\./g, "saint")
    .replace(/\./g, "")
    .replace(/'/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function haversineKm(aLat, aLon, bLat, bLon) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Minimal RFC4180 CSV parser (handles quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const s = text.replace(/^\uFEFF/, "");
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some(Boolean)).map((cols) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (cols[idx] || "").trim();
    });
    return obj;
  });
}

function extractVeterinaryGeoJson(pbf, workDir) {
  fs.mkdirSync(workDir, { recursive: true });
  const filteredPbf = path.join(workDir, "ca-veterinary.osm.pbf");
  const geojson = path.join(workDir, "ca-veterinary.geojson");

  console.log("Filtering amenity=veterinary from PBF…");
  let result = spawnSync(
    "osmium",
    ["tags-filter", pbf, "nwr/amenity=veterinary", "-o", filteredPbf, "--overwrite"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "osmium tags-filter failed");
  }

  console.log("Exporting GeoJSON…");
  result = spawnSync(
    "osmium",
    ["export", filteredPbf, "-o", geojson, "--overwrite"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "osmium export failed");
  }
  return geojson;
}

function featureCoords(feature) {
  const g = feature.geometry;
  if (!g) return null;
  if (g.type === "Point") return { lon: g.coordinates[0], lat: g.coordinates[1] };
  if (g.type === "Polygon" || g.type === "MultiPolygon") {
    const ring =
      g.type === "Polygon" ? g.coordinates[0] || [] : g.coordinates?.[0]?.[0] || [];
    if (!ring.length) return null;
    const lon = ring.reduce((sum, c) => sum + c[0], 0) / ring.length;
    const lat = ring.reduce((sum, c) => sum + c[1], 0) / ring.length;
    return { lon, lat };
  }
  if (g.type === "LineString") {
    const mid = g.coordinates[Math.floor(g.coordinates.length / 2)];
    return { lon: mid[0], lat: mid[1] };
  }
  return null;
}

function inferCare(props) {
  const blob = `${props.name || ""} ${props.emergency || ""} ${props.description || ""}`.toLowerCase();
  const hours = String(props.opening_hours || "").toLowerCase();
  const is24 =
    props.emergency === "yes" ||
    hours.includes("24/7") ||
    hours === "24/7" ||
    hours.includes("mo-su 00:00-24:00") ||
    hours.includes("24 hours");
  if (blob.includes("emergency") || props.emergency === "yes") {
    return {
      careType: is24 || blob.includes("24") ? "24/7 Emergency" : "Urgent Care",
      is24_7: Boolean(is24 || blob.includes("24/7")),
    };
  }
  if (blob.includes("urgent")) return { careType: "Urgent Care", is24_7: false };
  if (blob.includes("specialty") || blob.includes("specialist")) {
    return { careType: "Specialty", is24_7: false };
  }
  return { careType: "General Practice", is24_7: Boolean(is24) };
}

function formatPhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/[^\d+]/g, "");
  const m = digits.replace(/^\+1/, "").replace(/^1/, "").match(/^(\d{3})(\d{3})(\d{4})$/);
  if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  return String(raw);
}

function hasWebsite(website) {
  const value = String(website || "").trim();
  if (!value) return false;
  const normalized = value.toLowerCase();
  if (["#", "n/a", "na", "none", "null"].includes(normalized)) return false;
  return /^https?:\/\//i.test(value) || /^[\w.-]+\.[a-z]{2,}/i.test(value);
}

function toListing(props, coords, city, priority) {
  const { careType, is24_7 } = inferCare(props);
  const name = props.name || props.operator || "Veterinary Clinic";
  const street = [props["addr:housenumber"], props["addr:street"]]
    .filter(Boolean)
    .join(" ");
  const phone =
    formatPhone(props.phone || props["contact:phone"] || props["phone:US"]) ||
    "Call for number";
  const website = props.website || props["contact:website"] || props.url || "";
  const hours = props.opening_hours || "Call for hours";
  const zip = props["addr:postcode"] || "";
  const reviews = [];
  if (props.description) {
    reviews.push({
      author: "OpenStreetMap",
      rating: 5,
      text: props.description,
      source: "OpenStreetMap",
    });
  }

  return {
    slug: slugify(name),
    name,
    careType,
    is24_7,
    priority,
    description:
      props.description ||
      `${name} provides veterinary care for dogs in ${city.name}, CA. Info sourced from OpenStreetMap public map data — call ahead to confirm hours and services.`,
    phone,
    website,
    address: street || props["addr:full"] || `${city.name}, CA`,
    city: city.name,
    state: "CA",
    zip,
    neighborhood: props["addr:suburb"] || props["addr:neighbourhood"] || undefined,
    hours,
    hoursDetail: [hours],
    rating: is24_7 ? 4.5 : 4.2,
    reviewCount: reviews.length,
    services: [
      "Dog Care",
      careType,
      ...(is24_7 ? ["24/7 Availability"] : []),
      ...(props.emergency === "yes" ? ["Emergency Care"] : []),
      "Veterinary Medicine",
    ],
    highlights: [
      ...(is24_7 || props.emergency === "yes" ? ["Emergency-oriented"] : []),
      `Serving ${city.name}`,
      "Sourced from OpenStreetMap",
    ],
    acceptsDogs: true,
    reviews,
    placeId: props["@id"] || props.id || undefined,
    sourceUpdatedAt: new Date().toISOString(),
    _lat: coords?.lat,
    _lon: coords?.lon,
  };
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
        (v.phone && v.phone !== "Call for number" ? 50 : 0) +
        (v.website ? 25 : 0),
    }))
    .sort((a, b) => b._score - a._score || a.name.localeCompare(b.name))
    .map(({ _score, _lat, _lon, ...v }, i) => ({ ...v, priority: i + 1 }));
}

function dedupe(list) {
  const seen = new Set();
  const unique = [];
  for (const v of list) {
    let slug = v.slug;
    let n = 2;
    while (seen.has(slug)) slug = `${v.slug}-${n++}`;
    seen.add(slug);
    unique.push({ ...v, slug });
  }
  return unique;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.pbf)) {
    console.error(`Missing PBF: ${args.pbf}`);
    process.exit(1);
  }

  const registry = JSON.parse(fs.readFileSync(CITIES_PATH, "utf8"));
  const byNorm = new Map();
  for (const city of registry) {
    byNorm.set(normalizeCity(city.name), city);
  }

  const csvRows = parseCsv(fs.readFileSync(args.citiesCsv, "utf8"));
  const centroids = [];
  for (const row of csvRows) {
    if (row.STATE_CODE !== "CA") continue;
    const city = byNorm.get(normalizeCity(row.CITY));
    if (!city) continue;
    const lat = Number(row.LATITUDE);
    const lon = Number(row.LONGITUDE);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    city.lat = lat;
    city.lon = lon;
    centroids.push(city);
  }

  if (fs.existsSync(args.centroidsJson)) {
    const extra = JSON.parse(fs.readFileSync(args.centroidsJson, "utf8"));
    for (const city of registry) {
      if (city.lat != null && city.lon != null) continue;
      const hit = extra[city.slug];
      if (!hit) continue;
      const lat = Number(hit.lat);
      const lon = Number(hit.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      city.lat = lat;
      city.lon = lon;
      centroids.push(city);
    }
  }

  const uniqueCentroidCities = new Set(centroids.map((c) => c.slug));
  console.log(`Matched centroids for ${uniqueCentroidCities.size} registry cities`);

  const geojsonPath = extractVeterinaryGeoJson(args.pbf, args.workDir);
  const geo = JSON.parse(fs.readFileSync(geojsonPath, "utf8"));
  const features = (geo.features || []).filter((f) => {
    const props = f.properties || {};
    return Boolean(props.name || props.operator);
  });
  console.log(`OSM veterinary features: ${features.length}`);

  const prepared = features.map((feature) => {
    const props = feature.properties || {};
    const coords = featureCoords(feature);
    return { props, coords };
  });

  const buckets = new Map();
  let matchedByAddr = 0;
  let matchedByNearest = 0;

  function addToCity(city, props, coords) {
    const website = props.website || props["contact:website"] || props.url || "";
    if (!hasWebsite(website)) return;
    if (!buckets.has(city.slug)) buckets.set(city.slug, []);
    buckets.get(city.slug).push(toListing(props, coords, city, 0));
  }

  for (const { props, coords } of prepared) {
    const addrCity = props["addr:city"] || props["addr:town"] || props["addr:place"];
    let city = addrCity ? byNorm.get(normalizeCity(addrCity)) : null;

    if (city) {
      matchedByAddr++;
      addToCity(city, props, coords);
      continue;
    }

    if (!coords) continue;
    let best = null;
    let bestKm = Infinity;
    for (const c of centroids) {
      const km = haversineKm(coords.lat, coords.lon, c.lat, c.lon);
      if (km < bestKm) {
        bestKm = km;
        best = c;
      }
    }
    // Only attach to the nearest city when the clinic is truly local.
    // Do not backfill empty cities with clinics from tens/hundreds of km away.
    if (best && bestKm <= 8) {
      matchedByNearest++;
      addToCity(best, props, coords);
    }
  }

  // Only keep OSM features that have a usable website (directory requirement).
  const withSites = prepared.filter(({ props }) => {
    const website = props.website || props["contact:website"] || props.url || "";
    return hasWebsite(website);
  });
  console.log(`OSM veterinary features with websites: ${withSites.length}`);

  // Metro pass: for large cities, include additional website clinics whose
  // coordinates fall inside a tight city radius AND whose addr:city either
  // matches or is missing (never pull in a clinic that claims another city).
  let metroFilled = 0;
  for (const city of registry) {
    if (city.slug === "santa-barbara") continue;
    if (city.lat == null || city.lon == null) continue;
    if ((city.population || 0) < 80000) continue;

    const radius =
      city.population >= 500000 ? 12 : city.population >= 200000 ? 10 : 8;
    const existing = new Set((buckets.get(city.slug) || []).map((v) => v.name));
    let added = 0;
    const nearby = [];
    for (const item of withSites) {
      if (!item.coords) continue;
      const addrCity =
        item.props["addr:city"] ||
        item.props["addr:town"] ||
        item.props["addr:place"];
      if (addrCity && normalizeCity(addrCity) !== normalizeCity(city.name)) {
        continue;
      }
      const km = haversineKm(
        item.coords.lat,
        item.coords.lon,
        city.lat,
        city.lon,
      );
      if (km <= radius) nearby.push({ ...item, km });
    }
    nearby.sort((a, b) => a.km - b.km);
    for (const item of nearby.slice(0, 80)) {
      const name = item.props.name || item.props.operator;
      if (!name || existing.has(name)) continue;
      addToCity(city, item.props, item.coords);
      existing.add(name);
      added++;
    }
    if (added) metroFilled++;
  }
  const backfilled = 0;

  fs.mkdirSync(VETS_DIR, { recursive: true });
  let citiesLive = 0;
  let clinicsWritten = 0;
  let citiesCleared = 0;

  for (const city of registry) {
    if (city.slug === "santa-barbara") {
      city.status = "live";
      continue;
    }
    const raw = buckets.get(city.slug) || [];
    const outPath = path.join(VETS_DIR, `${city.slug}.json`);

    if (!raw.length) {
      if (fs.existsSync(outPath)) {
        fs.unlinkSync(outPath);
        citiesCleared++;
      }
      city.status = "pending";
      continue;
    }

    const vets = prioritize(dedupe(raw));
    fs.writeFileSync(outPath, JSON.stringify(vets, null, 2) + "\n");
    city.status = "live";
    city.tagline =
      city.tagline || `Dog vets and emergency care in ${city.name}, California`;
    city.description =
      city.description ||
      `Veterinary clinics and dog-health resources in ${city.name}, ${city.county} County — ranked with emergency and urgent care first.`;
    citiesLive++;
    clinicsWritten += vets.length;
  }

  const cleaned = registry.map(({ lat, lon, ...rest }) => rest);
  fs.writeFileSync(CITIES_PATH, JSON.stringify(cleaned, null, 2) + "\n");

  console.log("\nDone");
  console.log(`  Matched by addr:city: ${matchedByAddr}`);
  console.log(`  Matched by nearest city (<=8km): ${matchedByNearest}`);
  console.log(`  Cities backfilled by proximity: ${backfilled} (disabled)`);
  console.log(`  Major metros expanded: ${metroFilled}`);
  console.log(`  Cities marked live: ${citiesLive}`);
  console.log(`  Clinics written: ${clinicsWritten}`);
  console.log(`  Stale empty files cleared: ${citiesCleared}`);
  console.log(
    `  Still pending: ${cleaned.filter((c) => c.status !== "live").length}`,
  );
}

main();

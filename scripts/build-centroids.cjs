#!/usr/bin/env node
/**
 * Assign centroids for CA registry cities missing from us_cities.csv
 * using a lightweight Nominatim lookup (rate-limited).
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const CITIES_PATH = path.join(ROOT, "src/data/cities/california.json");
const OUT = "/tmp/pawharbor-osm/city-centroids.json";
const CSV = "/tmp/us_cities.csv";

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
  return rows
    .slice(1)
    .filter((r) => r.some(Boolean))
    .map((cols) => {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = (cols[idx] || "").trim();
      });
      return obj;
    });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function geocode(city) {
  const q = encodeURIComponent(`${city.name}, ${city.county} County, California, USA`);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "DogVetNearYou/1.0 (directory enrichment)",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  if (!data?.[0]) return null;
  return { lat: Number(data[0].lat), lon: Number(data[0].lon) };
}

async function main() {
  const registry = JSON.parse(fs.readFileSync(CITIES_PATH, "utf8"));
  const byNorm = new Map(registry.map((c) => [normalizeCity(c.name), c]));
  const centroids = {};

  for (const row of parseCsv(fs.readFileSync(CSV, "utf8"))) {
    if (row.STATE_CODE !== "CA") continue;
    const city = byNorm.get(normalizeCity(row.CITY));
    if (!city) continue;
    const lat = Number(row.LATITUDE);
    const lon = Number(row.LONGITUDE);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    centroids[city.slug] = { lat, lon, source: "csv" };
  }

  const missing = registry.filter((c) => !centroids[c.slug]);
  console.log(`CSV centroids: ${Object.keys(centroids).length}; missing: ${missing.length}`);

  for (let i = 0; i < missing.length; i++) {
    const city = missing[i];
    process.stdout.write(`[${i + 1}/${missing.length}] ${city.name}… `);
    try {
      const hit = await geocode(city);
      if (hit) {
        centroids[city.slug] = { ...hit, source: "nominatim" };
        console.log(`${hit.lat},${hit.lon}`);
      } else {
        console.log("NOT FOUND");
      }
    } catch (err) {
      console.log(`ERR ${err.message}`);
    }
    await sleep(1100);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(centroids, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(centroids).length} centroids → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

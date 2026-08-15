# Dog Vet Near You

USA dog health & veterinary directory — city pages with 24/7 emergency first.

## Live routes

| Route | Purpose |
| --- | --- |
| `/` | Brand home |
| `/ca` | All **483** California cities |
| `/ca/[city]` | City directory (live clinics or queue) |
| `/ca/[city]/[slug]` | Clinic profile |
| `/santa-barbara` | Redirects → `/ca/santa-barbara` |

## Santa Barbara standard

`/ca/santa-barbara` is the reference experience for every live city:

1. **Emergency / call strip** at the top with clickable clinic phones
2. **Clinic cards** with care type, hours, phone CTA, and ratings when available
3. **Clinic detail pages** with contact, hours, services, highlights, and a **Reviews** section

Bulk cities use the same UI. Data is enriched toward that standard via:

```bash
npm run enrich:websites   # phones + site testimonials
npm run enrich:reviews -- --all   # Google ratings/reviews (needs GOOGLE_PLACES_API_KEY)
```

## Data model

1. **City registry** — `src/data/cities/california.json`
2. **Clinic schema** — shared `VetListing` type (phone, hours, services, reviews, emergency-first `priority`)
3. **Sources**
   - Curated: `src/data/santa-barbara.ts` (highest quality)
   - Curated supplements: `src/data/curated-supplements.json` (verified local clinics + websites)
   - City-accurate rebuild: `npm run enrich:rebuild` (OSM + re-geocoded unique clinics; **no distant-neighbor backfill**)
4. **Enrichment**
   - Google Places (optional): `npm run enrich -- --city los-angeles`
   - OpenStreetMap statewide: `npm run enrich:osm` (requires PBF; assigns by `addr:city` / nearby ≤8km only)

```bash
# Rebuild city-accurate listings from OSM + geocoded clinics (requires network)
npm run enrich:rebuild

# Full OSM PBF pipeline (requires california-latest.osm.pbf + us_cities.csv)
npm run enrich:osm
```

**Directory rule:** each city page only lists clinics that actually belong in that city, with a reachable public website. Empty cities stay `pending` rather than borrowing clinics from other metros.
## Develop

```bash
npm install
npm run dev
```

Open [http://localhost:3000/ca](http://localhost:3000/ca).

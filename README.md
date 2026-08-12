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

## Data model

1. **City registry** — `src/data/cities/california.json`
2. **Clinic schema** — shared `VetListing` type (phone, hours, services, reviews, emergency-first `priority`)
3. **Sources**
   - Curated: `src/data/santa-barbara.ts` (highest quality)
   - Bulk OSM: `src/data/vets/ca/{city}.json`
4. **Enrichment**
   - Google Places (optional): `npm run enrich -- --city los-angeles`
   - OpenStreetMap statewide: `npm run enrich:osm`

```bash
# Requires california-latest.osm.pbf + us_cities.csv (see scripts)
npm run enrich:osm
```

## Develop

```bash
npm install
npm run dev
```

Open [http://localhost:3000/ca](http://localhost:3000/ca).

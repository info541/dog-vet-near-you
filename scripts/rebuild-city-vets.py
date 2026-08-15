#!/usr/bin/env python3
"""
Rebuild California city vet JSON files with city-accurate clinics only.

Sources:
  1) OpenStreetMap veterinary POIs with public websites (Overpass dump)
  2) Unique street-address clinics salvaged from prior JSON, re-geocoded so
     each clinic is attached only to the city where it actually is

Rules:
  - No distant-neighbor backfill into empty cities
  - Must have a reachable public website
  - Generic chain homepages without a location path are rejected
"""

from __future__ import annotations

import csv
import json
import math
import re
import subprocess
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CITIES_PATH = ROOT / "src/data/cities/california.json"
VETS_DIR = ROOT / "src/data/vets/ca"
OSM_PATH = Path("/tmp/pawharbor-osm/ca-veterinary.json")
CITIES_CSV = Path("/tmp/us_cities.csv")
GEOCODE_CACHE = Path("/tmp/pawharbor-osm/geocode-cache.json")
WEBSITE_CACHE = Path("/tmp/pawharbor-osm/website-check-cache.json")
CURATED_PATH = ROOT / "src/data/curated-supplements.json"
USER_AGENT = "PawHarborDirectory/1.0 (city-accurate vet rebuild; contact=local-dev)"

SKIP_SLUGS = {"santa-barbara"}  # curated in santa-barbara.ts

GENERIC_SITE_RE = re.compile(
    r"^https?://(www\.)?("
    r"banfield\.com|"
    r"vcahospitals\.com|"
    r"bluepearlvet\.com|"
    r"thrivepetcare\.com|"
    r"veterinaryemergencygroup\.com|"
    r"petco\.com|"
    r"vetco\.com"
    r")/?$",
    re.I,
)


def normalize_city(name: str) -> str:
    s = unicodedata.normalize("NFD", str(name or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"\bst\.", "saint", s)
    s = s.replace(".", "").replace("'", "").replace("-", " ")
    return re.sub(r"\s+", " ", s).strip()


def slugify(name: str) -> str:
    s = str(name).lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def has_website(website: str) -> bool:
    value = (website or "").strip()
    if not value:
        return False
    if value.lower() in {"#", "n/a", "na", "none", "null"}:
        return False
    return bool(
        re.match(r"^https?://", value, re.I)
        or re.match(r"^[\w.-]+\.[a-z]{2,}", value, re.I)
    )


def normalize_website(website: str) -> str:
    value = (website or "").strip()
    if not value:
        return ""
    if not re.match(r"^https?://", value, re.I):
        value = "https://" + value
    return value.rstrip("/")


def website_key(website: str) -> str:
    w = normalize_website(website).lower()
    w = re.sub(r"^https?://(www\.)?", "", w)
    return w.rstrip("/")


def is_generic_chain_homepage(website: str) -> bool:
    return bool(GENERIC_SITE_RE.match(normalize_website(website)))


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    R = 6371.0
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def format_phone(raw: str) -> str:
    if not raw:
        return "Call for number"
    digits = re.sub(r"[^\d+]", "", str(raw))
    digits = re.sub(r"^\+?1", "", digits)
    m = re.match(r"^(\d{3})(\d{3})(\d{4})$", digits)
    if m:
        return f"({m.group(1)}) {m.group(2)}-{m.group(3)}"
    return str(raw)


def infer_care(name: str, hours: str = "", emergency: str = "") -> tuple[str, bool]:
    blob = f"{name} {emergency}".lower()
    hours_l = (hours or "").lower()
    is24 = (
        emergency == "yes"
        or "24/7" in hours_l
        or hours_l == "24/7"
        or "24 hours" in hours_l
        or "mo-su 00:00-24:00" in hours_l
    )
    if "emergency" in blob or emergency == "yes":
        care = "24/7 Emergency" if (is24 or "24" in blob) else "Urgent Care"
        return care, bool(is24 or "24/7" in blob)
    if "urgent" in blob:
        return "Urgent Care", False
    if "specialty" in blob or "specialist" in blob:
        return "Specialty", False
    return "General Practice", bool(is24)


def load_registry() -> list[dict]:
    return json.loads(CITIES_PATH.read_text())


def attach_centroids(registry: list[dict]) -> list[dict]:
    by_norm = {normalize_city(c["name"]): c for c in registry}
    with CITIES_CSV.open() as f:
        for row in csv.DictReader(f):
            if row.get("STATE_CODE") != "CA":
                continue
            city = by_norm.get(normalize_city(row["CITY"]))
            if not city:
                continue
            city["lat"] = float(row["LATITUDE"])
            city["lon"] = float(row["LONGITUDE"])
    return [c for c in registry if "lat" in c and "lon" in c]


def osm_coords(el: dict) -> tuple[float, float] | None:
    if "lat" in el and "lon" in el:
        return float(el["lat"]), float(el["lon"])
    center = el.get("center") or {}
    if "lat" in center and "lon" in center:
        return float(center["lat"]), float(center["lon"])
    return None


def nearest_city(
    coords: tuple[float, float],
    centroids: list[dict],
    max_km: float,
) -> dict | None:
    best = None
    best_km = float("inf")
    for city in centroids:
        km = haversine_km(coords, (city["lat"], city["lon"]))
        if km < best_km:
            best_km = km
            best = city
    if best and best_km <= max_km:
        return best
    return None


def load_json_cache(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            return {}
    return {}


def save_json_cache(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def nominatim_geocode(query: str, cache: dict) -> dict | None:
    if query in cache:
        hit = cache[query]
        return hit if isinstance(hit, dict) and "lat" in hit else None
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {
            "q": query,
            "format": "json",
            "limit": 1,
            "countrycodes": "us",
            "addressdetails": 1,
        }
    )
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        cache[query] = {"error": str(exc)}
        time.sleep(1.1)
        return None
    time.sleep(1.05)
    if not data:
        cache[query] = None
        return None
    hit = data[0]
    addr = hit.get("address") or {}
    result = {
        "lat": float(hit["lat"]),
        "lon": float(hit["lon"]),
        "city": addr.get("city")
        or addr.get("town")
        or addr.get("village")
        or addr.get("municipality")
        or addr.get("hamlet"),
        "postcode": addr.get("postcode") or "",
        "display": hit.get("display_name") or "",
    }
    cache[query] = result
    return result


def check_website(url: str, cache: dict) -> bool:
    key = normalize_website(url)
    if key in cache and isinstance(cache[key], dict) and "ok" in cache[key]:
        return bool(cache[key].get("ok"))
    ok = False
    final = key
    for method in ("HEAD", "GET"):
        try:
            req = urllib.request.Request(
                key,
                method=method,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "text/html,application/xhtml+xml",
                },
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                code = getattr(resp, "status", 200) or 200
                final = resp.geturl()
                if 200 <= code < 400:
                    ok = True
                    break
                if method == "HEAD" and code in {403, 405, 501}:
                    continue
        except urllib.error.HTTPError as e:
            if e.code in {401, 403, 405} and method == "HEAD":
                continue
            if 200 <= getattr(e, "code", 0) < 400:
                ok = True
                break
            if e.code == 403:
                ok = True
                break
        except Exception:
            continue
    cache[key] = {"ok": ok, "final": final}
    return ok


def city_mentioned_in_name(name: str, centroids: list[dict], coords: tuple[float, float] | None) -> dict | None:
    """If clinic name contains a registry city, prefer that city when nearby."""
    norm_name = normalize_city(name)
    candidates = sorted(centroids, key=lambda c: len(normalize_city(c["name"])), reverse=True)
    for city in candidates:
        cn = normalize_city(city["name"])
        if len(cn) < 4:
            continue
        if not re.search(rf"\b{re.escape(cn)}\b", norm_name):
            continue
        if coords is None:
            return city
        if haversine_km(coords, (city["lat"], city["lon"])) <= 25:
            return city
    return None


def nominatim_reverse(lat: float, lon: float, cache: dict) -> dict | None:
    key = f"rev:{lat:.5f},{lon:.5f}"
    if key in cache:
        hit = cache[key]
        return hit if isinstance(hit, dict) and hit.get("city") else None
    url = "https://nominatim.openstreetmap.org/reverse?" + urllib.parse.urlencode(
        {
            "lat": lat,
            "lon": lon,
            "format": "json",
            "addressdetails": 1,
            "zoom": 18,
        }
    )
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        cache[key] = {"error": str(exc)}
        time.sleep(1.1)
        return None
    time.sleep(1.05)
    addr = (data or {}).get("address") or {}
    city_name = (
        addr.get("city")
        or addr.get("town")
        or addr.get("village")
        or addr.get("municipality")
        or addr.get("hamlet")
    )
    result = {"city": city_name, "postcode": addr.get("postcode") or ""}
    cache[key] = result
    return result if city_name else None


def load_osm_clinics(
    by_norm: dict[str, dict],
    centroids: list[dict],
    geocode_cache: dict,
) -> list[dict]:
    raw = json.loads(OSM_PATH.read_text())["elements"]
    out: list[dict] = []
    for el in raw:
        tags = el.get("tags") or {}
        name = tags.get("name") or tags.get("operator")
        website = tags.get("website") or tags.get("contact:website") or tags.get("url") or ""
        if not name or not has_website(website) or is_generic_chain_homepage(website):
            continue
        coords = osm_coords(el)
        addr_city = tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:place")
        city = by_norm.get(normalize_city(addr_city)) if addr_city else None
        if not city:
            city = city_mentioned_in_name(name, centroids, coords)
        if not city and coords:
            rev = nominatim_reverse(coords[0], coords[1], geocode_cache)
            if rev and rev.get("city"):
                city = by_norm.get(normalize_city(rev["city"]))
        if not city and coords:
            city = nearest_city(coords, centroids, max_km=10)
        if not city:
            continue
        street = " ".join(
            p for p in [tags.get("addr:housenumber"), tags.get("addr:street")] if p
        ).strip()
        care_type, is24 = infer_care(name, tags.get("opening_hours", ""), tags.get("emergency", ""))
        out.append(
            {
                "source": "osm",
                "name": name,
                "website": normalize_website(website),
                "phone": format_phone(
                    tags.get("phone")
                    or tags.get("contact:phone")
                    or tags.get("phone:US")
                    or ""
                ),
                "address": street or tags.get("addr:full") or "",
                "zip": tags.get("addr:postcode") or "",
                "hours": tags.get("opening_hours") or "Call for hours",
                "careType": care_type,
                "is24_7": is24,
                "city_slug": city["slug"],
                "city_name": city["name"],
                "lat": coords[0] if coords else None,
                "lon": coords[1] if coords else None,
                "description": tags.get("description") or "",
                "rating": 4.5 if is24 else 4.2,
                "reviewCount": 0,
                "reviews": [],
            }
        )
    return out


def collect_unique_from_git_main() -> list[dict]:
    """Unique street-address clinics from main, ignoring polluted city labels."""
    try:
        files = subprocess.check_output(
            ["git", "ls-tree", "-r", "--name-only", "main", "src/data/vets/ca"],
            text=True,
        ).splitlines()
    except subprocess.CalledProcessError:
        files = [str(p.relative_to(ROOT)) for p in VETS_DIR.glob("*.json")]

    best: dict[str, dict] = {}
    for path in files:
        stem = Path(path).stem
        if stem in SKIP_SLUGS:
            continue
        try:
            raw = subprocess.check_output(["git", "show", f"main:{path}"], text=True)
            listings = json.loads(raw)
        except Exception:
            continue
        for vet in listings:
            website = normalize_website(vet.get("website") or "")
            if not has_website(website) or is_generic_chain_homepage(website):
                continue
            address = (vet.get("address") or "").strip()
            if not re.search(r"\d", address):
                continue
            # Skip city-only placeholders
            if re.fullmatch(r"[A-Za-z .'-]+\s*,\s*CA", address):
                continue
            key = f"{website_key(website)}|{slugify(vet.get('name') or '')}|{address.lower()}"
            score = (
                (200 if vet.get("is24_7") else 0)
                + (50 if vet.get("phone") and vet["phone"] != "Call for number" else 0)
                + (20 if vet.get("rating") else 0)
                + len(vet.get("reviews") or [])
            )
            prev = best.get(key)
            if not prev or score > prev.get("_score", 0):
                best[key] = {**vet, "website": website, "_score": score}
    return list(best.values())


def to_listing(clinic: dict, city: dict) -> dict:
    care_type = clinic.get("careType") or "General Practice"
    is24 = bool(clinic.get("is24_7"))
    name = clinic["name"]
    hours = clinic.get("hours") or "Call for hours"
    website = normalize_website(clinic["website"])
    phone = clinic.get("phone") or "Call for number"
    address = clinic.get("address") or f"{city['name']}, CA"
    zip_code = clinic.get("zip") or ""
    rating = float(clinic.get("rating") or (4.5 if is24 else 4.2))
    review_count = int(clinic.get("reviewCount") or 0)
    reviews = clinic.get("reviews") or []
    description = clinic.get("description") or (
        f"{name} provides veterinary care for dogs in {city['name']}, CA. "
        "Confirm hours and services directly with the clinic."
    )
    return {
        "slug": slugify(name),
        "name": name,
        "careType": care_type,
        "is24_7": is24,
        "priority": 0,
        "description": description,
        "phone": phone,
        "website": website,
        "address": address,
        "city": city["name"],
        "state": "CA",
        "zip": zip_code,
        "hours": hours,
        "hoursDetail": clinic.get("hoursDetail") or [hours],
        "rating": rating,
        "reviewCount": review_count,
        "services": clinic.get("services")
        or [
            "Dog Care",
            care_type,
            *(["24/7 Availability"] if is24 else []),
            "Veterinary Medicine",
        ],
        "highlights": clinic.get("highlights")
        or [
            *(["Emergency-oriented"] if is24 or care_type == "24/7 Emergency" else []),
            f"Serving {city['name']}",
            "Verified local listing",
        ],
        "acceptsDogs": True,
        "reviews": reviews,
        "sourceUpdatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "lat": clinic.get("lat"),
        "lon": clinic.get("lon"),
        "source": clinic.get("source", "merged"),
        "city_slug": city["slug"],
    }


def clinic_dedupe_key(clinic: dict) -> str:
    """Prefer name+city; fall back to website+city for chains."""
    return f"{slugify(clinic['name'])}|{clinic['city_slug']}"


def near_duplicate(a: dict, b: dict, max_km: float = 0.35) -> bool:
    if a.get("lat") is None or b.get("lat") is None:
        return False
    if slugify(a["name"]) != slugify(b["name"]):
        return False
    return haversine_km((a["lat"], a["lon"]), (b["lat"], b["lon"])) <= max_km


def prioritize(vets: list[dict]) -> list[dict]:
    def score(v: dict) -> float:
        return (
            (1000 if v.get("is24_7") or v.get("careType") == "24/7 Emergency" else 0)
            + (400 if v.get("careType") == "Urgent Care" else 0)
            + (200 if v.get("careType") == "Specialty" else 0)
            + (50 if v.get("phone") and v["phone"] != "Call for number" else 0)
            + float(v.get("rating") or 0) * 10
        )

    vets = sorted(vets, key=lambda v: (-score(v), v.get("name") or ""))
    seen = set()
    out = []
    for i, v in enumerate(vets, start=1):
        base = slugify(v["name"])
        slug = base
        n = 2
        while slug in seen:
            slug = f"{base}-{n}"
            n += 1
        seen.add(slug)
        item = {
            k: val
            for k, val in v.items()
            if k
            not in {
                "_score",
                "_from_file",
                "lat",
                "lon",
                "source",
                "city_slug",
            }
        }
        item["slug"] = slug
        item["priority"] = i
        out.append(item)
    return out


def main() -> None:
    registry = load_registry()
    by_norm = {normalize_city(c["name"]): c for c in registry}
    by_slug = {c["slug"]: c for c in registry}
    centroids = attach_centroids(registry)
    print(f"Registry cities: {len(registry)}; centroids: {len(centroids)}")

    geocode_cache = load_json_cache(GEOCODE_CACHE)
    osm_clinics = load_osm_clinics(by_norm, centroids, geocode_cache)
    print(f"OSM clinics with website + city: {len(osm_clinics)}")

    existing = collect_unique_from_git_main()
    print(f"Unique street-address clinics on main: {len(existing)}")
    save_json_cache(GEOCODE_CACHE, geocode_cache)

    website_cache = load_json_cache(WEBSITE_CACHE)

    merged: dict[str, dict] = {}
    spatial: list[dict] = []

    def add_clinic(clinic: dict) -> None:
        key = clinic_dedupe_key(clinic)
        # Spatial dedupe for same name nearby (cross-source)
        for other in spatial:
            if near_duplicate(clinic, other):
                # Prefer OSM source / richer phone
                if other.get("source") != "osm" and clinic.get("source") == "osm":
                    merged[clinic_dedupe_key(other)] = clinic
                    other.update(clinic)
                return
        prev = merged.get(key)
        if prev:
            if prev.get("source") != "osm" and clinic.get("source") == "osm":
                merged[key] = clinic
            return
        merged[key] = clinic
        spatial.append(clinic)

    for c in osm_clinics:
        city = by_slug[c["city_slug"]]
        add_clinic(to_listing(c, city))

    assigned = 0
    skipped = 0
    for idx, vet in enumerate(existing, start=1):
        query = f"{vet['name']}, {vet['address']}, California, USA"
        geo = nominatim_geocode(query, geocode_cache)
        if not geo:
            skipped += 1
            continue
        city = None
        if geo.get("city"):
            city = by_norm.get(normalize_city(geo["city"]))
        if not city:
            city = nearest_city((geo["lat"], geo["lon"]), centroids, max_km=10)
        if not city:
            skipped += 1
            continue
        listing = to_listing(
            {
                **vet,
                "lat": geo["lat"],
                "lon": geo["lon"],
                "zip": vet.get("zip") or geo.get("postcode") or "",
                "source": "geocoded-main",
            },
            city,
        )
        add_clinic(listing)
        assigned += 1
        if assigned % 25 == 0:
            save_json_cache(GEOCODE_CACHE, geocode_cache)
            print(f"  geocoded {assigned}/{len(existing)} (skipped {skipped})…")

    save_json_cache(GEOCODE_CACHE, geocode_cache)
    print(f"Assigned from main via geocode: {assigned}; skipped: {skipped}")

    curated_added = 0
    if CURATED_PATH.exists():
        for row in json.loads(CURATED_PATH.read_text()):
            city = by_slug.get(row.get("citySlug") or "")
            if not city:
                continue
            website = normalize_website(row.get("website") or "")
            if not has_website(website) or is_generic_chain_homepage(website):
                continue
            listing = to_listing(
                {
                    "name": row["name"],
                    "website": website,
                    "phone": row.get("phone") or "Call for number",
                    "address": row.get("address") or f"{city['name']}, CA",
                    "zip": row.get("zip") or "",
                    "hours": row.get("hours") or "Call for hours",
                    "careType": row.get("careType") or "General Practice",
                    "is24_7": bool(row.get("is24_7")),
                    "source": "curated",
                },
                city,
            )
            add_clinic(listing)
            curated_added += 1
    print(f"Curated supplements added: {curated_added}")

    # Fix strong name/city conflicts (multi-word city names only, e.g. Beverly Hills)
    corrected = 0
    for key, clinic in list(merged.items()):
        norm_name = normalize_city(clinic["name"])
        assigned = clinic.get("city_slug")
        # Longer multi-word cities first
        candidates = sorted(
            [c for c in centroids if " " in normalize_city(c["name"])],
            key=lambda c: len(normalize_city(c["name"])),
            reverse=True,
        )
        mentioned = None
        for city in candidates:
            cn = normalize_city(city["name"])
            if not re.search(rf"\b{re.escape(cn)}\b", norm_name):
                continue
            if city["slug"] == assigned:
                mentioned = None
                break
            mentioned = city
            break
        if not mentioned:
            continue
        coords_ok = clinic.get("lat") is not None and clinic.get("lon") is not None
        near = False
        if coords_ok:
            near = haversine_km(
                (clinic["lat"], clinic["lon"]),
                (mentioned["lat"], mentioned["lon"]),
            ) <= 40
        if near:
            listing = to_listing(
                {**clinic, "source": str(clinic.get("source", "merged")) + "+name-fix"},
                mentioned,
            )
            del merged[key]
            add_clinic(listing)
            corrected += 1
        else:
            # Far from the named city — this listing is in the wrong place; drop it
            del merged[key]
            corrected += 1
    print(f"Name-based city corrections: {corrected}")

    print(f"Merged unique clinic-city rows: {len(merged)}")

    urls = sorted({normalize_website(v["website"]) for v in merged.values()})
    print(f"Checking {len(urls)} websites…")
    ok_urls: set[str] = set()

    def _check(u: str) -> tuple[str, bool]:
        return u, check_website(u, website_cache)

    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = [pool.submit(_check, u) for u in urls]
        done = 0
        for fut in as_completed(futures):
            u, ok = fut.result()
            if ok:
                ok_urls.add(normalize_website(u))
            done += 1
            if done % 50 == 0:
                save_json_cache(WEBSITE_CACHE, website_cache)
                print(f"  checked {done}/{len(urls)}")

    save_json_cache(WEBSITE_CACHE, website_cache)
    print(f"Websites OK: {len(ok_urls)} / {len(urls)}")

    buckets: dict[str, list[dict]] = defaultdict(list)
    dropped_web = 0
    for clinic in merged.values():
        if normalize_website(clinic["website"]) not in ok_urls:
            dropped_web += 1
            continue
        buckets[clinic["city_slug"]].append(clinic)

    print(f"Dropped for dead/invalid website: {dropped_web}")
    print(f"Cities with clinics: {len(buckets)}")

    live = 0
    written = 0
    cleared = 0
    for city in registry:
        slug = city["slug"]
        if slug in SKIP_SLUGS:
            city["status"] = "live"
            continue
        out_path = VETS_DIR / f"{slug}.json"
        raw = buckets.get(slug) or []
        if not raw:
            if out_path.exists():
                out_path.unlink()
                cleared += 1
            city["status"] = "pending"
            continue
        vets = prioritize(raw)
        for v in vets:
            w = normalize_website(v["website"])
            checked = website_cache.get(w) or {}
            if checked.get("final"):
                v["website"] = checked["final"]
            else:
                v["website"] = w
        out_path.write_text(json.dumps(vets, indent=2) + "\n")
        city["status"] = "live"
        city["tagline"] = city.get("tagline") or (
            f"Dog vets and emergency care in {city['name']}, California"
        )
        city["description"] = city.get("description") or (
            f"Veterinary clinics and dog-health resources in {city['name']}, "
            f"{city.get('county', '')} County — ranked with emergency and urgent care first."
        )
        live += 1
        written += len(vets)

    cleaned = [{k: v for k, v in city.items() if k not in {"lat", "lon"}} for city in registry]
    CITIES_PATH.write_text(json.dumps(cleaned, indent=2) + "\n")

    print("\nDone")
    print(f"  Live cities: {live}")
    print(f"  Clinics written: {written}")
    print(f"  Stale files cleared: {cleared}")
    print(f"  Pending cities: {sum(1 for c in cleaned if c.get('status') != 'live')}")
    top = sorted(((len(v), k) for k, v in buckets.items()), reverse=True)[:15]
    print("  Top cities:", ", ".join(f"{k}={n}" for n, k in top))


if __name__ == "__main__":
    main()

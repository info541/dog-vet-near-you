#!/usr/bin/env python3
"""
Enrich clinic JSON from each clinic's own website:
  - phone numbers (tel: links / visible patterns)
  - testimonial / review snippets
  - shortName for emergency strip labels

Usage:
  python3 scripts/enrich-from-websites.py
  python3 scripts/enrich-from-websites.py --limit 40
"""

from __future__ import annotations

import argparse
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from html import unescape
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
VETS_DIR = ROOT / "src/data/vets/ca"
CACHE_PATH = Path("/tmp/pawharbor-osm/website-enrich-cache.json")
USER_AGENT = (
    "Mozilla/5.0 (compatible; PawHarborBot/1.0; +https://github.com/info541/dog-vet-near-you)"
)

PHONE_RE = re.compile(
    r"(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}"
)
TEL_HREF_RE = re.compile(r"""href=["']tel:([^"']+)["']""", re.I)
TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")

# Blocks that often hold testimonials on veterinary sites
BLOCK_PATTERNS = [
    re.compile(
        r'<(?:blockquote|div|section|article|li)[^>]*(?:class|id)=["\'][^"\']*'
        r'(?:testimonial|review|quote|feedback|client-story|google-review)[^"\']*["\'][^>]*>(.*?)</(?:blockquote|div|section|article|li)>',
        re.I | re.S,
    ),
    re.compile(r"<blockquote[^>]*>(.*?)</blockquote>", re.I | re.S),
]


def load_cache() -> dict:
    if CACHE_PATH.exists():
        try:
            return json.loads(CACHE_PATH.read_text())
        except Exception:
            return {}
    return {}


def save_cache(cache: dict) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache, indent=2) + "\n")


def normalize_website(url: str) -> str:
    value = (url or "").strip()
    if not value:
        return ""
    if not re.match(r"^https?://", value, re.I):
        value = "https://" + value
    return value


def format_phone(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("1") and len(digits) == 11:
        digits = digits[1:]
    if len(digits) != 10:
        return None
    return f"({digits[0:3]}) {digits[3:6]}-{digits[6:10]}"


def strip_html(html: str) -> str:
    text = TAG_RE.sub(" ", html)
    text = unescape(text)
    return WS_RE.sub(" ", text).strip()


def fetch(url: str, timeout: int = 18) -> str | None:
    req = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            ctype = (resp.headers.get("Content-Type") or "").lower()
            if "html" not in ctype and "text" not in ctype and ctype:
                return None
            for enc in ("utf-8", "latin-1"):
                try:
                    return raw.decode(enc)
                except Exception:
                    continue
            return raw.decode("utf-8", "ignore")
    except Exception:
        return None


def extract_phones(html: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for match in TEL_HREF_RE.findall(html):
        phone = format_phone(unescape(match))
        if phone and phone not in seen:
            seen.add(phone)
            found.append(phone)
    # Prefer tel: hits; fall back to visible numbers near "call" / "phone"
    if found:
        return found
    for match in PHONE_RE.findall(html):
        phone = format_phone(match)
        if phone and phone not in seen:
            seen.add(phone)
            found.append(phone)
        if len(found) >= 5:
            break
    return found


def extract_reviews(html: str, clinic_name: str) -> list[dict]:
    reviews: list[dict] = []
    seen_text: set[str] = set()

    # JSON-LD Review / AggregateRating
    for block in re.findall(
        r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        re.I | re.S,
    ):
        try:
            data = json.loads(block.strip())
        except Exception:
            continue
        nodes = data if isinstance(data, list) else [data]
        for node in nodes:
            if not isinstance(node, dict):
                continue
            graph = node.get("@graph")
            if isinstance(graph, list):
                nodes.extend(graph)
            ntype = node.get("@type")
            types = ntype if isinstance(ntype, list) else [ntype]
            if "Review" in types or ntype == "Review":
                body = (
                    (node.get("reviewBody") or node.get("description") or "")
                    if isinstance(node.get("reviewBody") or node.get("description"), str)
                    else ""
                )
                author = node.get("author")
                if isinstance(author, dict):
                    author = author.get("name")
                rating = node.get("reviewRating")
                if isinstance(rating, dict):
                    rating = rating.get("ratingValue")
                text = WS_RE.sub(" ", str(body)).strip()
                if len(text) < 40 or text.lower() in seen_text:
                    continue
                seen_text.add(text.lower())
                try:
                    rating_n = float(rating or 5)
                except Exception:
                    rating_n = 5
                reviews.append(
                    {
                        "author": str(author or "Pet parent")[:60],
                        "rating": max(1, min(5, rating_n)),
                        "text": text[:600],
                        "source": "Clinic website",
                    }
                )

    for pattern in BLOCK_PATTERNS:
        for chunk in pattern.findall(html):
            text = strip_html(chunk)
            if len(text) < 50 or len(text) > 700:
                continue
            # Skip nav / cookie / boilerplate
            low = text.lower()
            if any(
                bad in low
                for bad in (
                    "cookie",
                    "privacy policy",
                    "copyright",
                    "all rights reserved",
                    "book online",
                    "call us",
                    "value feedback",
                    "small sample",
                    "leave a review",
                    "write a review",
                    "click here",
                )
            ):
                continue
            if clinic_name.lower() in low and len(text) < 90:
                continue
            # Prefer first-person / pet-care language
            if not re.search(
                r"\b(dog|cat|pet|vet|doctor|staff|care|clinic|hospital|thank|recommend|love|pup)\b",
                low,
            ):
                continue
            key = text.lower()
            if key in seen_text:
                continue
            seen_text.add(key)
            # Try to split author from trailing dash / emdash
            author = "Pet parent"
            m = re.search(
                r"[—\-–]\s*([A-Z][a-z]+(?:\s+[A-Z]\.?)?)\s*$",
                text,
            )
            if m:
                author = m.group(1)
                text = text[: m.start()].strip().strip("“\"'").strip()
            reviews.append(
                {
                    "author": author[:60],
                    "rating": 5,
                    "text": text[:600],
                    "source": "Clinic website",
                }
            )
            if len(reviews) >= 5:
                return reviews

    return reviews[:5]


def short_name_for(name: str, care_type: str, is24: bool) -> str | None:
    if not (is24 or care_type == "24/7 Emergency" or care_type == "Urgent Care"):
        return None
    cleaned = re.sub(
        r"\b(animal|veterinary|veterinarian|pet|hospital|clinic|center|centre|specialty|and|emergency|urgent|care|of|the)\b",
        " ",
        name,
        flags=re.I,
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    parts = [p for p in re.split(r"\s+", cleaned) if p]
    if not parts:
        # initials from original
        initials = "".join(w[0] for w in re.findall(r"[A-Za-z]+", name)[:3]).upper()
        return initials or None
    if len(parts) == 1:
        return parts[0][:18]
    return " ".join(parts[:2])[:22]


def enrich_one(vet: dict, cache: dict) -> dict:
    website = normalize_website(vet.get("website") or "")
    if not website:
        return vet

    cache_key = website.rstrip("/").lower()
    cached = cache.get(cache_key)
    if not cached:
        html = fetch(website)
        # Try common contact pages if home yields little
        pages = [html] if html else []
        if html and ("tel:" not in html.lower() or "testimonial" not in html.lower()):
            for path in ("/contact", "/contact-us", "/about", "/testimonials", "/reviews"):
                sub = urljoin(website if website.endswith("/") else website + "/", path.lstrip("/"))
                sub_html = fetch(sub)
                if sub_html:
                    pages.append(sub_html)
                time.sleep(0.15)
        phones: list[str] = []
        reviews: list[dict] = []
        for page in pages:
            if not page:
                continue
            for p in extract_phones(page):
                if p not in phones:
                    phones.append(p)
            for r in extract_reviews(page, vet.get("name") or ""):
                if r["text"].lower() not in {x["text"].lower() for x in reviews}:
                    reviews.append(r)
        cached = {"phones": phones[:3], "reviews": reviews[:5], "fetchedAt": time.time()}
        cache[cache_key] = cached

    next_vet = dict(vet)
    phone = next_vet.get("phone") or ""
    if (not phone or phone == "Call for number") and cached.get("phones"):
        next_vet["phone"] = cached["phones"][0]
    if cached.get("phones") and len(cached["phones"]) > 1 and not next_vet.get("phoneSecondary"):
        if cached["phones"][1] != next_vet.get("phone"):
            next_vet["phoneSecondary"] = cached["phones"][1]

    existing = list(next_vet.get("reviews") or [])
    if cached.get("reviews"):
        # Prefer website testimonials when we have none
        if not existing:
            next_vet["reviews"] = cached["reviews"]
            if not next_vet.get("reviewCount"):
                next_vet["reviewCount"] = max(len(cached["reviews"]), int(next_vet.get("reviewCount") or 0))
            if not next_vet.get("rating"):
                next_vet["rating"] = round(
                    sum(r["rating"] for r in cached["reviews"]) / len(cached["reviews"]),
                    1,
                )
        else:
            # Append unique website reviews
            seen = {r.get("text", "").lower() for r in existing}
            for r in cached["reviews"]:
                if r["text"].lower() not in seen:
                    existing.append(r)
                    seen.add(r["text"].lower())
            next_vet["reviews"] = existing[:6]

    # Ensure displayable rating if we have review texts
    if next_vet.get("reviews") and not (next_vet.get("reviewCount") and next_vet.get("rating")):
        revs = next_vet["reviews"]
        next_vet["rating"] = round(sum(float(r.get("rating") or 5) for r in revs) / len(revs), 1)
        next_vet["reviewCount"] = max(int(next_vet.get("reviewCount") or 0), len(revs))

    sn = short_name_for(
        next_vet.get("name") or "",
        next_vet.get("careType") or "General Practice",
        bool(next_vet.get("is24_7")),
    )
    if sn and not next_vet.get("shortName"):
        next_vet["shortName"] = sn

    # If OSM marked 24/7 but careType stayed General Practice, fix it
    if next_vet.get("is24_7") and next_vet.get("careType") == "General Practice":
        next_vet["careType"] = "24/7 Emergency"

    return next_vet


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--city", type=str, default="")
    args = parser.parse_args()

    files = sorted(VETS_DIR.glob("*.json"))
    if args.city:
        files = [VETS_DIR / f"{args.city}.json"]
        if not files[0].exists():
            raise SystemExit(f"missing {files[0]}")

    cache = load_cache()
    considered = 0
    updated = 0
    phones_fixed = 0
    reviews_added = 0

    jobs: list[tuple[Path, int, dict]] = []
    for file in files:
        vets = json.loads(file.read_text())
        for i, vet in enumerate(vets):
            jobs.append((file, i, vet))
            if args.limit and len(jobs) >= args.limit:
                break
        if args.limit and len(jobs) >= args.limit:
            break

    print(f"Enriching {len(jobs)} clinics from websites…")

    # Group by file for writing
    by_file: dict[Path, list[dict]] = {}
    for file in files:
        by_file[file] = json.loads(file.read_text())

    def work(item: tuple[Path, int, dict]):
        file, idx, vet = item
        return file, idx, enrich_one(vet, cache)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(work, job) for job in jobs]
        done = 0
        for fut in as_completed(futures):
            file, idx, next_vet = fut.result()
            considered += 1
            prev = by_file[file][idx]
            changed = json.dumps(prev, sort_keys=True) != json.dumps(next_vet, sort_keys=True)
            if changed:
                if (prev.get("phone") == "Call for number" or not prev.get("phone")) and next_vet.get(
                    "phone"
                ) not in (None, "", "Call for number"):
                    phones_fixed += 1
                if len(next_vet.get("reviews") or []) > len(prev.get("reviews") or []):
                    reviews_added += 1
                by_file[file][idx] = next_vet
                updated += 1
            done += 1
            if done % 25 == 0:
                save_cache(cache)
                print(f"  {done}/{len(jobs)} updated={updated} phones={phones_fixed} reviews={reviews_added}")

    for file, vets in by_file.items():
        # Only rewrite files we touched
        if any(job[0] == file for job in jobs):
            file.write_text(json.dumps(vets, indent=2) + "\n")

    save_cache(cache)
    print("\nDone")
    print(f"  Considered: {considered}")
    print(f"  Updated: {updated}")
    print(f"  Phones fixed: {phones_fixed}")
    print(f"  Clinics gaining reviews: {reviews_added}")


if __name__ == "__main__":
    main()

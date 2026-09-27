"""Pull my Letterboxd diary into data/films.json and data/posters/.

Standard library only, so it runs anywhere python3 exists:

    python3 scripts/sync_films.py

The RSS feed only holds the latest ~50 entries, so this only ever adds to or
updates films.json - films that fall off the feed stay on the site.

It also creates reviews/<slug>.md for each reviewed film that doesn't have
one yet, pre-filled with its genres and cast, ready to edit, and writes
films/<slug>.html (a copy of film.html with that film's link-preview tags)
so links pasted into Discord etc. show the poster and title.
"""

import html
import json
import urllib.parse
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

USERNAME = "xtrakitty"
SITE_URL = "https://log4n.com"  # link previews need full URLs
FEED_URL = f"https://letterboxd.com/{USERNAME}/rss/"
USER_AGENT = "Mozilla/5.0 (log4n film sync; +https://github.com/KrakenTheJaken/log4n)"

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "films.json"
POSTER_DIR = ROOT / "data" / "posters"
REVIEW_DIR = ROOT / "reviews"
PAGE_DIR = ROOT / "films"
TEMPLATE = ROOT / "film.html"
FEED_SIZE = 50  # Letterboxd's RSS feed holds at most this many items

NS = {
    "letterboxd": "https://letterboxd.com",
    "tmdb": "https://themoviedb.org",
}

SPOILER_NOTE = re.compile(r"<p>\s*<em>\s*This review may contain spoilers\.\s*</em>\s*</p>", re.I)
FILM_KEYS = [
    "title", "year", "released", "director", "runtime", "cast", "genres", "myGenres", "myTags", "tags", "quote",
    "tmdb", "letterboxd", "poster", "hasReview", "listed", "auto", "watches",
]
TOP_CAST = 4  # how many top-billed actors get listed unless the review file says otherwise
HTML_COMMENT = re.compile(r"<!--.*?-->", re.S)

LD_JSON = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
FRONT_MATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", re.S)

POSTER_IMG = re.compile(r'<p>\s*<img src="([^"]+)"[^>]*/?>\s*</p>', re.I)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def text(item, tag):
    el = item.find(tag, NS)
    return el.text.strip() if el is not None and el.text else ""


def parse_feed(xml_bytes):
    """Yields (slug, film_info, watch) for every diary entry in the feed."""
    channel = ET.fromstring(xml_bytes).find("channel")
    for item in channel.findall("item"):
        guid = text(item, "guid")
        # Lists also show up in the feed; only diary entries have a watched date.
        # Guids look like letterboxd-review-123 (has text) or letterboxd-watch-123.
        match = re.fullmatch(r"letterboxd-(?:review|watch)-(\d+)", guid)
        if not match or not text(item, "letterboxd:watchedDate"):
            continue

        link = text(item, "link")
        slug_match = re.search(r"/film/([^/]+)/", link)
        if not slug_match:
            continue
        slug = slug_match.group(1)

        description = text(item, "description")
        poster_match = POSTER_IMG.search(description)
        spoilers = bool(SPOILER_NOTE.search(description))
        take = SPOILER_NOTE.sub("", POSTER_IMG.sub("", description)).strip()

        rating = text(item, "letterboxd:memberRating")
        film = {
            "title": html.unescape(text(item, "letterboxd:filmTitle")),
            "year": int(text(item, "letterboxd:filmYear") or 0) or None,
            "tmdb": int(text(item, "tmdb:movieId") or 0) or None,
            "letterboxd": f"https://letterboxd.com/film/{slug}/",
            "posterSource": poster_match.group(1) if poster_match else None,
        }
        watch = {
            "id": match.group(1),
            "date": text(item, "letterboxd:watchedDate"),
            "rating": float(rating) if rating else None,
            "liked": text(item, "letterboxd:memberLike") == "Yes",
            "rewatch": text(item, "letterboxd:rewatch") == "Yes",
            "spoilers": spoilers,
            "take": take,  # Letterboxd's own sanitized HTML (<p>, <br>, <i>, ...)
            "url": link,
        }
        yield slug, film, watch


def download_poster(slug, source):
    """Saves the poster once; returns its site path, or None if it failed."""
    dest = POSTER_DIR / f"{slug}.jpg"
    if not dest.exists():
        try:
            dest.write_bytes(fetch(source))
            print(f"  poster saved: {dest.name}")
        except Exception as err:  # a missing poster shouldn't stop the sync
            print(f"  poster failed for {slug}: {err}", file=sys.stderr)
            return None
    return f"/data/posters/{slug}.jpg"


def fetch_film_details(slug):
    """What Letterboxd says about a film (director, genres, cast, runtime), or None.

    The public film page carries schema.org JSON-LD, which is sturdier than
    scraping the visible HTML. Only fetched once per film.
    """
    try:
        page = fetch(f"https://letterboxd.com/film/{slug}/").decode("utf-8", "replace")
        match = LD_JSON.search(page)
        raw = re.sub(r"/\*.*?\*/", "", match.group(1), flags=re.S)  # strips CDATA comments
        data = json.loads(raw)
    except Exception as err:  # try again on the next run
        print(f"  details failed for {slug}: {err}", file=sys.stderr)
        return None
    print(f"  details saved: {slug}")
    runtime = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?", data.get("duration") or "")
    return {
        "director": ", ".join(d["name"] for d in data.get("director", [])) or None,
        "genres": [g.lower() for g in data.get("genre", [])],
        "cast": [a["name"] for a in data.get("actor", [])[:12]],  # billing order
        "runtime": int(runtime.group(1) or 0) * 60 + int(runtime.group(2) or 0) if runtime else None,
    }


def fetch_release_dates(films):
    """Fills auto["released"] (YYYY-MM-DD) for films that don't have one yet.

    Wikidata lists every release of a film (each country, festivals, city
    premieres), keyed here by the TMDB id from the feed. "The" release is
    the nationwide US one; failing that, the earliest nationwide release
    anywhere. Festivals and single-city premieres don't count. Films with
    nothing usable (yet) keep None, show just the year, and get re-checked
    on later runs.
    """
    todo = {str(f["tmdb"]): f for f in films.values()
            if f.get("tmdb") and "auto" in f and not f["auto"].get("released")}
    if not todo:
        return
    query = """
        SELECT ?tmdb ?date ?precision ?place ?type WHERE {
          VALUES ?tmdb { %s }
          ?film wdt:P4947 ?tmdb; p:P577 ?statement.
          ?statement psv:P577 [ wikibase:timeValue ?date; wikibase:timePrecision ?precision ].
          OPTIONAL { ?statement pq:P291 ?place. OPTIONAL { ?place wdt:P31 ?type } }
        }""" % " ".join(f'"{tmdb}"' for tmdb in todo)
    url = "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(query)
    try:
        rows = json.loads(fetch(url))["results"]["bindings"]
    except Exception as err:  # try again on the next run
        print(f"  release dates failed: {err}", file=sys.stderr)
        return

    US = "http://www.wikidata.org/entity/Q30"
    COUNTRY_TYPES = {"http://www.wikidata.org/entity/Q6256", "http://www.wikidata.org/entity/Q3624078"}
    releases = {}  # tmdb -> {place: (date, is_country)}
    for row in rows:
        if row["precision"]["value"] != "11":  # 11 = exact day; skip year-only entries
            continue
        place = row.get("place", {}).get("value")
        if not place:
            continue
        date = row["date"]["value"][:10]
        known = releases.setdefault(row["tmdb"]["value"], {}).get(place, (date, False))
        is_country = known[1] or row.get("type", {}).get("value") in COUNTRY_TYPES or place == US
        releases[row["tmdb"]["value"]][place] = (min(known[0], date), is_country)

    for tmdb, film in todo.items():
        places = releases.get(tmdb, {})
        if US in places:
            film["auto"]["released"] = places[US][0]
        else:
            countries = [date for date, is_country in places.values() if is_country]
            film["auto"]["released"] = min(countries) if countries else None
        if film["auto"]["released"]:
            print(f"  released: {film['title']} {film['auto']['released']}")


def featured_watch(film):
    """The watch whose Letterboxd review is featured: the latest, unless the
    review file says `quote: first` or `quote: <watch date>`."""
    watches, quote = film["watches"], film.get("quote")
    if quote == "first":
        return watches[-1]
    return next((w for w in watches if w["date"] == quote), watches[0])


def write_preview_pages(films):
    """Writes films/<slug>.html for each listed film: film.html plus the
    title/description/poster tags that Discord, iMessage etc. read. Those
    sites don't run JavaScript, so the tags have to be in the file itself.
    Cloudflare serves films/<slug>.html at /films/<slug>.
    """
    PAGE_DIR.mkdir(exist_ok=True)
    template = TEMPLATE.read_text()
    wanted = set()
    for slug, film in films.items():
        if not film.get("listed"):
            continue
        wanted.add(f"{slug}.html")
        latest = featured_watch(film)
        stars = "★" * int(latest["rating"] or 0) + ("½" if (latest["rating"] or 0) % 1 else "")
        take = "" if latest["spoilers"] else re.sub(r"\s+", " ", html.unescape(
            re.sub(r"<br\s*/?>|</p>", " ", latest["take"])
        ))
        take = re.sub(r"<[^>]+>", "", take).strip()
        if len(take) > 180:
            take = take[:177].rstrip() + "..."
        heading = f"{film['title']} ({film['year']})" if film.get("year") else film["title"]
        description = " · ".join(filter(None, [
            (stars + (" ♥" if latest["liked"] else "")).strip(),
            f"“{take}”" if take else "",
            f"dir. {film['director']}" if film.get("director") else "",
        ]))
        esc = lambda v: html.escape(v, quote=True)
        tags = "\n".join([
            f"<!-- generated by scripts/sync_films.py from film.html; edit film.html instead -->",
            f'<meta name="description" content="{esc(description)}">',
            f'<meta property="og:site_name" content="log4n">',
            f'<meta property="og:type" content="article">',
            f'<meta property="og:title" content="{esc(heading)}">',
            f'<meta property="og:description" content="{esc(description)}">',
            f'<meta property="og:url" content="{SITE_URL}/films/{slug}">',
            f'<meta property="og:image" content="{SITE_URL}{film["poster"]}">' if film.get("poster") else "",
            f'<meta name="twitter:card" content="summary">',
            f'<meta name="theme-color" content="#e8604f">',
        ])
        page = re.sub(r"<title>.*?</title>", lambda _: f"<title>{esc(heading)} - log4n</title>\n{tags}", template, count=1)
        path = PAGE_DIR / f"{slug}.html"
        if not path.exists() or path.read_text() != page:
            path.write_text(page)

    for path in PAGE_DIR.glob("*.html"):
        if path.name not in wanted:  # film was deleted or unlisted
            path.unlink()


def read_review(slug):
    """Returns (has_body, fields) for reviews/<slug>.md.

    A review can start with a block of comma-separated lists:
        ---
        tags: comfort movie, cried
        genres: crime, thriller, neo-noir
        cast: Fred MacMurray, Barbara Stanwyck
        quote: first
        ---
    `tags` land in "my tags". `genres` and `cast` replace what Letterboxd says
    (the sync pre-fills them, so editing means adding or removing). A field
    that's missing from the file is None, meaning "use Letterboxd's".
    `quote` picks which Letterboxd review is featured: first, latest, or a
    watch date (YYYY-MM-DD); it defaults to latest.
    """
    fields = {"tags": None, "genres": None, "cast": None, "quote": None}
    path = REVIEW_DIR / f"{slug}.md"
    if not path.exists():
        return False, fields
    source = path.read_text()
    match = FRONT_MATTER.match(source)
    if match:
        source = source[match.end():]
        for line in match.group(1).splitlines():
            key, _, value = line.partition(":")
            key = key.strip().lower()
            if key == "quote":
                fields["quote"] = value.strip().lower() or None
            elif key in fields:
                values = [v.strip() for v in value.split(",") if v.strip()]
                fields[key] = values if key == "cast" else [v.lower() for v in values]
    # A file with only the tag block (or only comments) isn't a review.
    return bool(HTML_COMMENT.sub("", source).strip()), fields


def write_review_stub(slug, film):
    """Creates reviews/<slug>.md with the tag block filled in, if it's missing."""
    path = REVIEW_DIR / f"{slug}.md"
    if path.exists():
        return
    auto = film["auto"]
    path.write_text(
        "---\n"
        "tags: \n"
        f"genres: {', '.join(auto['genres'])}\n"
        f"cast: {', '.join(auto['cast'][:TOP_CAST])}\n"
        "---\n"
        "\n"
        f"<!-- {film['title']} ({film['year']}). Edit the lists above: tags are your own,\n"
        "     genres and cast show exactly as written (add or remove freely).\n"
        "     Rewatched it? Add `quote: first` (or a watch date) above to pick which\n"
        "     Letterboxd review is featured; it's the latest one otherwise.\n"
        "     Write a review under this comment, or leave it empty to keep just the tags.\n"
        "     Formatting help: reviews/examples/formatting-guide.md -->\n"
    )
    print(f"  review file created: {path.relative_to(ROOT)}")


def remove_deleted(films, entries, feed_full):
    """Drops diary entries I deleted on Letterboxd.

    Anything missing from the feed was either deleted or just scrolled out
    of the feed's last 50 items. Only the first is a reason to remove it: if
    the feed isn't full, everything still exists is in it; if it is full,
    only entries newer than its oldest one can be judged.
    """
    in_feed = {watch["id"] for _, _, watch in entries}
    oldest = min(watch["date"] for _, _, watch in entries)
    for slug in list(films):
        kept = [w for w in films[slug]["watches"]
                if w["id"] in in_feed or (feed_full and w["date"] < oldest)]
        if len(kept) != len(films[slug]["watches"]):
            print(f"  removed {len(films[slug]['watches']) - len(kept)} deleted entry(s): {slug}")
        if kept:
            films[slug]["watches"] = kept
        else:
            del films[slug]  # its review file stays, in case it comes back


def main():
    POSTER_DIR.mkdir(parents=True, exist_ok=True)
    films = json.loads(DATA_FILE.read_text()) if DATA_FILE.exists() else {}

    feed_ok = True
    try:
        feed = fetch(FEED_URL)
        entries = list(parse_feed(feed))
    except Exception as err:
        # Still refresh hasReview below, then fail so the Action shows red.
        print(f"could not read {FEED_URL}: {err}", file=sys.stderr)
        feed, entries, feed_ok = b"", [], False

    if entries:
        remove_deleted(films, entries, feed_full=feed.count(b"<item>") >= FEED_SIZE)

    for slug, info, watch in entries:
        film = films.setdefault(slug, {"watches": []})
        source = info.pop("posterSource")
        film.update(info)
        if source and not film.get("poster"):
            film["poster"] = download_poster(slug, source)

        # Replace by id so editing a review on Letterboxd updates it here too.
        film["watches"] = [w for w in film["watches"] if w["id"] != watch["id"]] + [watch]
        film["watches"].sort(key=lambda w: (w["date"], w["id"]), reverse=True)

    for slug, film in films.items():
        if "auto" not in film:
            details = fetch_film_details(slug)
            if details:
                film["auto"] = details
    fetch_release_dates(films)

    for slug, film in films.items():
        auto = film.get("auto") or {"director": None, "genres": [], "cast": [], "runtime": None}
        # Only films I actually wrote something about go on the site. Rating-only
        # diary entries stay in the file in case I write a long review later.
        takes = any(w["take"] for w in film["watches"])
        if takes and "auto" in film:
            write_review_stub(slug, film)

        film["hasReview"], fields = read_review(slug)
        film["listed"] = film["hasReview"] or takes
        film["released"] = auto.get("released")
        film["director"] = auto["director"]
        film["runtime"] = auto["runtime"]
        film["genres"] = fields["genres"] if fields["genres"] is not None else auto["genres"]
        film["cast"] = fields["cast"] if fields["cast"] is not None else auto["cast"][:TOP_CAST]
        film["myTags"] = fields["tags"] or []
        film["quote"] = fields["quote"]
        film["myGenres"] = [g for g in film["genres"] if g not in auto["genres"]]
        decade = [f"{film['year'] // 10 * 10}s"] if film.get("year") else []
        # My own tags first, then genres and decade, without repeats.
        film["tags"] = list(dict.fromkeys(film["myTags"] + film["genres"] + decade))

    # Newest watch first, so the site can use the file order as-is.
    ordered = {
        slug: {key: film.get(key) for key in FILM_KEYS}
        for slug, film in sorted(films.items(), key=lambda kv: kv[1]["watches"][0]["date"], reverse=True)
    }
    DATA_FILE.write_text(json.dumps(ordered, indent=2, ensure_ascii=False) + "\n")
    write_preview_pages(ordered)
    print(f"{len(entries)} feed entries, {len(ordered)} films in {DATA_FILE.relative_to(ROOT)}")

    if not feed_ok:
        sys.exit(1)


if __name__ == "__main__":
    main()

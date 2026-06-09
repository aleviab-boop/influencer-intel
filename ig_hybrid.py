#!/usr/bin/env python3
"""
Hybrid Instagram profile finder — NO login, free, works right now.

Idea: Instagram blocks keyword *search* unless you're logged in, but it will
serve a PUBLIC profile's data (bio, followers, recent posts, and "related
accounts") to anyone. So instead of searching, we start from a few seed
usernames you already know and expand outward:

    seed profile -> its "related profiles" + @mentions in its captions
                 -> their related profiles + mentions -> ...

Every discovered profile is scored against your prompt (e.g. "nagpur fashion")
by how many of those words appear in its name / bio / category.

Usage:
    python3 ig_hybrid.py "nagpur fashion" --seeds nagpurfashion someblogger ...

    --seeds   one or more starting usernames (the more relevant, the better)
    --depth   how many hops to expand outward (default 2)
    --max     stop after visiting this many profiles (default 60)

No account, no password, no challenge. Just public data + polite throttling.
"""

import sys
import re
import csv
import time
import argparse
from collections import deque

import requests

# Public web app id Instagram's own website sends. Lets us hit the public
# JSON endpoint without logging in.
APP_ID = "936619743392459"
HEADERS = {
    "x-ig-app-id": APP_ID,
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
}

PROFILE_URL = "https://www.instagram.com/api/v1/users/web_profile_info/?username={}"
SLEEP = 3.0          # seconds between profile fetches (raise if you get blocked)
MENTION_RE = re.compile(r"@([A-Za-z0-9_.]{2,30})")


def fetch_profile(username, session):
    """Fetch one public profile's JSON. Returns the user dict or None."""
    url = PROFILE_URL.format(username)
    try:
        r = session.get(url, headers=HEADERS, timeout=15)
    except requests.RequestException as e:
        print(f"    (network error on {username}: {e})")
        return None

    if r.status_code == 404:
        return None
    if r.status_code in (401, 403, 429):
        print(f"    (Instagram blocked the request for {username} "
              f"[HTTP {r.status_code}] — slow down or try later)")
        return None
    try:
        return r.json()["data"]["user"]
    except (ValueError, KeyError, TypeError):
        # Instagram returned an HTML login page instead of JSON.
        print(f"    (no public JSON for {username} — likely login-walled)")
        return None


def summarize(user):
    """Pull the fields we care about out of the raw profile JSON."""
    return {
        "username": user.get("username", ""),
        "full_name": user.get("full_name") or "",
        "biography": user.get("biography") or "",
        "category": user.get("category_name") or "",
        "followers": (user.get("edge_followed_by") or {}).get("count", 0),
        "is_private": user.get("is_private"),
        "is_verified": user.get("is_verified"),
    }


def discover_links(user):
    """Return usernames to explore next: related profiles + caption @mentions."""
    found = set()

    # 1. Instagram's own "related / similar accounts" suggestions.
    related = (user.get("edge_related_profiles") or {}).get("edges", [])
    for edge in related:
        node = edge.get("node", {})
        if node.get("username"):
            found.add(node["username"])

    # 2. @mentions inside the captions of recent posts.
    media = (user.get("edge_owner_to_timeline_media") or {}).get("edges", [])
    for edge in media:
        caption_edges = (edge.get("node", {})
                         .get("edge_media_to_caption", {})
                         .get("edges", []))
        for c in caption_edges:
            text = c.get("node", {}).get("text", "")
            for m in MENTION_RE.findall(text):
                found.add(m.lower())

    return found


def score(prof, tokens):
    """How many prompt words appear in this profile's text fields."""
    haystack = " ".join([
        prof["username"], prof["full_name"],
        prof["biography"], prof["category"],
    ]).lower()
    return sum(1 for t in tokens if t in haystack)


def crawl(seeds, tokens, depth, max_profiles):
    session = requests.Session()
    visited = {}                      # username -> summarized profile
    queue = deque((s.lower(), 0) for s in seeds)
    seen = set(s.lower() for s in seeds)

    while queue and len(visited) < max_profiles:
        username, hop = queue.popleft()
        print(f"  [{len(visited)+1}/{max_profiles}] hop {hop}: @{username}")

        user = fetch_profile(username, session)
        time.sleep(SLEEP)
        if not user:
            continue

        prof = summarize(user)
        visited[username] = prof

        if hop < depth:
            for nxt in discover_links(user):
                if nxt not in seen:
                    seen.add(nxt)
                    queue.append((nxt, hop + 1))

    return visited


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("prompt", help='e.g. "nagpur fashion"')
    ap.add_argument("--seeds", nargs="+", required=True,
                    help="starting usernames you already know are relevant")
    ap.add_argument("--depth", type=int, default=2)
    ap.add_argument("--max", type=int, default=60, dest="max_profiles")
    ap.add_argument("--csv", metavar="FILE",
                    help="also write results to this CSV file")
    args = ap.parse_args()

    tokens = [t.lower() for t in args.prompt.split() if t.strip()]
    print(f"Prompt tokens: {tokens}")
    print(f"Seeds: {args.seeds}  depth={args.depth}  max={args.max_profiles}\n")

    profiles = crawl(args.seeds, tokens, args.depth, args.max_profiles)

    ranked = sorted(
        profiles.values(),
        key=lambda p: (score(p, tokens), p["followers"]),
        reverse=True,
    )

    print(f"\n=== {len(ranked)} profiles found, ranked by relevance ===\n")
    for i, p in enumerate(ranked, 1):
        flags = []
        if p["is_verified"]:
            flags.append("verified")
        flags.append("private" if p["is_private"] else "public")
        print(f"{i:2}. @{p['username']:<22} "
              f"score {score(p, tokens)}  "
              f"{p['followers']:>8,} followers  [{', '.join(flags)}]")
        if p["full_name"] or p["category"]:
            print(f"     {p['full_name']}  {('· ' + p['category']) if p['category'] else ''}")
        print(f"     https://instagram.com/{p['username']}")

    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow([
                "rank", "username", "full_name", "followers", "category",
                "score", "verified", "private", "url",
            ])
            for i, p in enumerate(ranked, 1):
                writer.writerow([
                    i, p["username"], p["full_name"], p["followers"],
                    p["category"], score(p, tokens),
                    bool(p["is_verified"]), bool(p["is_private"]),
                    f"https://instagram.com/{p['username']}",
                ])
        print(f"\nSaved {len(ranked)} profiles to {args.csv}")


if __name__ == "__main__":
    main()

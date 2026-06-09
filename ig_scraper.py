#!/usr/bin/env python3
"""
Instagram prompt -> relevant profiles finder (free, instagrapi-based).

Usage:
    export IG_USERNAME="your_throwaway_account"
    export IG_PASSWORD="your_password"
    python3 ig_scraper.py "nagpur fashion"

What it does:
    1. Tokenizes the prompt into a location guess + genre/keyword tokens.
    2. Searches Instagram hashtags, locations, and users for those tokens.
    3. Collects candidate profiles, scores them by relevance, prints the top ones.

Notes:
    - Use a THROWAWAY account, not your real one (scraping carries ban risk).
    - Go slow. The SLEEP constant throttles requests to look human.
    - Login session is cached to session.json so you don't re-login every run.
"""

import os
import sys
import time
import json

from instagrapi import Client
from instagrapi.exceptions import ClientError, ChallengeRequired

SESSION_FILE = "session.json"
SLEEP = 2.0          # seconds between API calls (raise if you get rate-limited)
MAX_PROFILES = 25    # how many ranked profiles to print

# A small built-in list of Indian cities so we can split "location" from "genre".
# Add more as you need; anything not in here is treated as a genre/keyword token.
KNOWN_CITIES = {
    "nagpur", "mumbai", "delhi", "bangalore", "bengaluru", "hyderabad",
    "chennai", "kolkata", "pune", "ahmedabad", "jaipur", "lucknow", "surat",
    "kanpur", "indore", "bhopal", "patna", "vadodara", "nashik", "goa",
}


def tokenize(prompt: str):
    """Split a prompt like 'nagpur fashion' into (location, genre_tokens)."""
    tokens = [t.strip().lower() for t in prompt.split() if t.strip()]
    location = None
    genre_tokens = []
    for t in tokens:
        if t in KNOWN_CITIES and location is None:
            location = t
        else:
            genre_tokens.append(t)
    return location, genre_tokens, tokens


def challenge_code_handler(username, choice):
    """Called by instagrapi when Instagram demands a verification code.

    `choice` tells us where the code was sent (email or SMS). We just ask
    you to paste it in. Check the inbox/phone of the throwaway account.
    """
    print(f"\n>>> Instagram sent a verification code to your {choice} "
          f"for account '{username}'.")
    return input(">>> Enter the code here and press Enter: ").strip()


def login() -> Client:
    """Log in, reusing a cached session when possible to reduce ban risk."""
    username = os.environ.get("IG_USERNAME")
    password = os.environ.get("IG_PASSWORD")
    if not username or not password:
        sys.exit("Set IG_USERNAME and IG_PASSWORD environment variables first.")

    cl = Client()
    cl.delay_range = [1, 3]  # instagrapi adds its own random delay between calls
    cl.challenge_code_handler = challenge_code_handler

    if os.path.exists(SESSION_FILE):
        try:
            cl.load_settings(SESSION_FILE)
            cl.login(username, password)
            cl.get_timeline_feed()  # validate the session actually works
            print("Reused cached session.")
            return cl
        except Exception:
            print("Cached session invalid, logging in fresh...")

    try:
        cl.login(username, password)
    except ChallengeRequired:
        print("Challenge required — asking Instagram to send a code...")
        cl.challenge_resolve(cl.last_json)
        # After resolving the challenge, complete the login.
        cl.login(username, password)

    cl.dump_settings(SESSION_FILE)
    print("Logged in and saved session.")
    return cl


def collect_candidates(cl: Client, location, genre_tokens, all_tokens):
    """Gather candidate profiles from hashtag, location, and user searches.

    Returns a dict keyed by user pk -> a lightweight profile dict.
    """
    candidates = {}

    def add_user(u):
        if u.pk in candidates:
            return
        candidates[u.pk] = {
            "pk": u.pk,
            "username": u.username,
            "full_name": getattr(u, "full_name", "") or "",
            "is_private": getattr(u, "is_private", None),
        }

    # Hashtags to try: the combined token (#nagpurfashion) + each genre token.
    hashtags = []
    if location and genre_tokens:
        hashtags.append(location + genre_tokens[0])
    hashtags.extend(genre_tokens)
    hashtags.append("".join(all_tokens))

    for tag in dict.fromkeys(hashtags):  # de-dupe, keep order
        try:
            print(f"  hashtag #{tag} ...")
            medias = cl.hashtag_medias_recent(tag, amount=20)
            for m in medias:
                if m.user:
                    add_user(m.user)
            time.sleep(SLEEP)
        except ClientError as e:
            print(f"    (skipped #{tag}: {e})")

    # Location search -> recent posts at that location.
    if location:
        try:
            print(f"  location '{location}' ...")
            locs = cl.fbsearch_places(location)
            if locs:
                medias = cl.location_medias_recent(locs[0].pk, amount=20)
                for m in medias:
                    if m.user:
                        add_user(m.user)
            time.sleep(SLEEP)
        except ClientError as e:
            print(f"    (skipped location: {e})")

    # Direct user search on the raw prompt and on the genre tokens.
    for term in dict.fromkeys([" ".join(all_tokens)] + genre_tokens):
        try:
            print(f"  user search '{term}' ...")
            users = cl.search_users(term, amount=20)
            for u in users:
                add_user(u)
            time.sleep(SLEEP)
        except ClientError as e:
            print(f"    (skipped user search '{term}': {e})")

    return candidates


def score_profile(prof, all_tokens):
    """Relevance score: how many query tokens show up in username/full name."""
    haystack = (prof["username"] + " " + prof["full_name"]).lower()
    return sum(1 for t in all_tokens if t in haystack)


def main():
    if len(sys.argv) < 2:
        sys.exit('Usage: python3 ig_scraper.py "nagpur fashion"')

    prompt = " ".join(sys.argv[1:])
    location, genre_tokens, all_tokens = tokenize(prompt)
    print(f"Prompt: {prompt!r}")
    print(f"  location guess: {location}")
    print(f"  genre tokens:   {genre_tokens}\n")

    cl = login()

    print("\nSearching Instagram...")
    candidates = collect_candidates(cl, location, genre_tokens, all_tokens)
    print(f"\nFound {len(candidates)} candidate profiles. Ranking...\n")

    ranked = sorted(
        candidates.values(),
        key=lambda p: score_profile(p, all_tokens),
        reverse=True,
    )

    for i, p in enumerate(ranked[:MAX_PROFILES], 1):
        score = score_profile(p, all_tokens)
        priv = "private" if p["is_private"] else "public"
        print(f"{i:2}. @{p['username']:<25} {p['full_name'][:30]:<30} "
              f"[score {score}, {priv}]")
        print(f"    https://instagram.com/{p['username']}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Creates DUAL's Game Center achievements in App Store Connect. Safe to re-run.

For every entry in ACHIEVEMENTS it makes sure the achievement exists, has an en-US
localization, and that the localization has its icon (store/achievements/<key>.png,
drawn by store/achievements/render.cjs). Existing achievements are left as they are —
points and visibility can't be changed once an achievement has shipped.

The IDs must match src/engine/Achievements.ts. Apple allows at most 100 points per
achievement and 1,000 per app; this set uses 800.

Env: ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID. Run: python3 scripts/setup-achievements.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from asc import call, upload_parts  # noqa: E402

BUNDLE_ID = "com.lukaschylik.dualmind"
ICONS = os.path.join(os.path.dirname(__file__), "..", "store", "achievements")

# key, name, points, hidden, before-earned text, after-earned text
ACHIEVEMENTS = [
    ("warmup", "Warm-up", 25, False,
     "Score 500 points in one run.", "Scored 500 points in one run."),
    ("level3", "Level 3", 50, False,
     "Reach level 3.", "Reached level 3."),
    ("level5", "Level 5", 75, False,
     "Reach level 5, where ghosts and bullet time appear.", "Reached level 5."),
    ("level7", "Level 7", 100, False,
     "Reach level 7.", "Reached level 7."),
    ("level10", "Level 10", 100, False,
     "Reach the last level.", "Reached level 10, the last one."),
    ("beyond", "Beyond", 100, True,
     "Clear level 10.", "Scored 10,000 points. There is no level 11."),
    ("ghosthunter", "Ghost Hunter", 100, False,
     "Collect 5 ghosts in one run.", "Collected 5 ghosts in one run."),
    ("slowmotion", "Slow Motion", 75, False,
     "Grab bullet time 3 times in one run.", "Grabbed bullet time 3 times in one run."),
    ("razorsedge", "Razor's Edge", 75, False,
     "Make 10 near misses in one run.", "Made 10 near misses in one run."),
    ("ambidextrous", "Ambidextrous", 100, False,
     "Reach level 5 with TWO HANDS control.", "Reached level 5 with TWO HANDS control."),
]


def detail_id():
    app = call("GET", "/v1/apps", query=f"filter[bundleId]={BUNDLE_ID}")["data"][0]["id"]
    return call("GET", f"/v1/apps/{app}/gameCenterDetail")["data"]["id"]


def existing(detail):
    out, path, query = {}, f"/v1/gameCenterDetails/{detail}/gameCenterAchievements", "limit=200"
    while path:
        d = call("GET", path, query=query)
        for a in d["data"]:
            out[a["attributes"]["vendorIdentifier"]] = a["id"]
        nxt = d.get("links", {}).get("next")
        path, _, query = nxt.replace("https://api.appstoreconnect.apple.com", "").partition("?") if nxt else ("", "", "")
    return out


def ensure_image(loc_id, key):
    img = call("GET", f"/v1/gameCenterAchievementLocalizations/{loc_id}/gameCenterAchievementImage")
    if img.get("data"):
        return "kept"
    path = os.path.join(ICONS, f"{key}.png")
    payload = open(path, "rb").read()
    res = call("POST", "/v1/gameCenterAchievementImages", {"data": {
        "type": "gameCenterAchievementImages",
        "attributes": {"fileSize": len(payload), "fileName": f"{key}.png"},
        "relationships": {"gameCenterAchievementLocalization": {
            "data": {"type": "gameCenterAchievementLocalizations", "id": loc_id}}}}})["data"]
    upload_parts(res["attributes"]["uploadOperations"], payload)
    call("PATCH", f"/v1/gameCenterAchievementImages/{res['id']}", {"data": {
        "type": "gameCenterAchievementImages", "id": res["id"], "attributes": {"uploaded": True}}})
    return "uploaded"


def main():
    detail = detail_id()
    have = existing(detail)
    total = 0
    for key, name, points, hidden, before, after in ACHIEVEMENTS:
        vid = f"dualmind.ach.{key}"
        total += points
        if vid in have:
            ach = have[vid]
            state = "exists"
        else:
            ach = call("POST", "/v1/gameCenterAchievements", {"data": {
                "type": "gameCenterAchievements",
                "attributes": {"referenceName": name, "vendorIdentifier": vid, "points": points,
                               "showBeforeEarned": not hidden, "repeatable": False},
                "relationships": {"gameCenterDetail": {
                    "data": {"type": "gameCenterDetails", "id": detail}}}}})["data"]["id"]
            state = "created"

        locs = call("GET", f"/v1/gameCenterAchievements/{ach}/localizations")["data"]
        loc = next((l for l in locs if l["attributes"]["locale"] == "en-US"), None)
        if loc is None:
            loc = call("POST", "/v1/gameCenterAchievementLocalizations", {"data": {
                "type": "gameCenterAchievementLocalizations",
                "attributes": {"locale": "en-US", "name": name,
                               "beforeEarnedDescription": before, "afterEarnedDescription": after},
                "relationships": {"gameCenterAchievement": {
                    "data": {"type": "gameCenterAchievements", "id": ach}}}}})["data"]
        image = ensure_image(loc["id"], key)
        print(f"{vid:28} {state:8} {points:3} pts  hidden={hidden!s:5}  image {image}")
    print(f"total {total} / 1000 points")


if __name__ == "__main__":
    main()

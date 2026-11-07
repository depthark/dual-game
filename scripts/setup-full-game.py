#!/usr/bin/env python3
"""Creates the "Full Game" in-app purchase in App Store Connect. Safe to re-run.

Non-consumable, Family Sharing on, available everywhere. Price: base USA $0.95,
€0.95 in every euro territory, 25 Kč in Czechia; Apple equalizes the rest.
Product ID must match ios/App/App/StorePlugin.swift.

Optional: --screenshot path.png attaches the App Review screenshot (the paywall).

Env: ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID. Run: python3 scripts/setup-full-game.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from asc import call, upload_parts  # noqa: E402

BUNDLE_ID = "com.lukaschylik.dualmind"
PRODUCT_ID = "com.lukaschylik.dualmind.fullgame"
NAME = "Full Game"
DESCRIPTION = "Unlock levels 6 to 10 for good."
REVIEW_NOTE = ("Levels 1-5 are free. When a player without this purchase reaches level 6 "
               "(5,000 points) the run pauses on a sheet offering this one-time unlock; "
               "it is also in Settings > FULL GAME, next to RESTORE. Players who installed "
               "version 1.0 keep every level for free.")
BASE = ("USA", 0.95)
EUR_PRICE = 0.95
OVERRIDES = {"CZE": 25.0}


def pages(path, query):
    out, d = [], call("GET", path, query=query)
    while True:
        out += d["data"]
        nxt = d.get("links", {}).get("next")
        if not nxt:
            return out
        p, _, q = nxt.replace("https://api.appstoreconnect.apple.com", "").partition("?")
        d = call("GET", p, query=q)


def main():
    app = call("GET", "/v1/apps", query=f"filter[bundleId]={BUNDLE_ID}")["data"][0]["id"]

    iap = next((i for i in pages(f"/v1/apps/{app}/inAppPurchasesV2", "limit=200")
                if i["attributes"]["productId"] == PRODUCT_ID), None)
    if iap is None:
        iap = call("POST", "/v2/inAppPurchases", {"data": {
            "type": "inAppPurchases",
            "attributes": {"name": NAME, "productId": PRODUCT_ID, "inAppPurchaseType": "NON_CONSUMABLE",
                           "reviewNote": REVIEW_NOTE, "familySharable": True},
            "relationships": {"app": {"data": {"type": "apps", "id": app}}}}})["data"]
        print("created", PRODUCT_ID)
    iid = iap["id"]

    locs = call("GET", f"/v2/inAppPurchases/{iid}/inAppPurchaseLocalizations")["data"]
    if not any(l["attributes"]["locale"] == "en-US" for l in locs):
        call("POST", "/v1/inAppPurchaseLocalizations", {"data": {
            "type": "inAppPurchaseLocalizations",
            "attributes": {"locale": "en-US", "name": NAME, "description": DESCRIPTION},
            "relationships": {"inAppPurchaseV2": {"data": {"type": "inAppPurchases", "id": iid}}}}})
        print("localized en-US")

    # price schedule (replaces any earlier one)
    territories = pages("/v1/territories", "limit=200")
    targets = {BASE[0]: BASE[1], **OVERRIDES}
    targets.update({t["id"]: EUR_PRICE for t in territories if t["attributes"].get("currency") == "EUR"})
    refs, included = [], []
    for n, (territory, price) in enumerate(sorted(targets.items())):
        point = next((p["id"] for p in pages(f"/v2/inAppPurchases/{iid}/pricePoints",
                                             f"filter[territory]={territory}&limit=200")
                      if abs(float(p["attributes"]["customerPrice"]) - price) < 0.001), None)
        if point is None:
            raise SystemExit(f"No {price} price point in {territory}")
        ref = f"${{price{n}}}"
        refs.append({"type": "inAppPurchasePrices", "id": ref})
        included.append({"type": "inAppPurchasePrices", "id": ref, "attributes": {"startDate": None},
                         "relationships": {
                             "inAppPurchasePricePoint": {"data": {"type": "inAppPurchasePricePoints", "id": point}},
                             "inAppPurchaseV2": {"data": {"type": "inAppPurchases", "id": iid}}}})
    call("POST", "/v1/inAppPurchasePriceSchedules", {"data": {
        "type": "inAppPurchasePriceSchedules",
        "relationships": {
            "inAppPurchase": {"data": {"type": "inAppPurchases", "id": iid}},
            "baseTerritory": {"data": {"type": "territories", "id": BASE[0]}},
            "manualPrices": {"data": refs}}}, "included": included})
    print(f"priced: {len(targets)} manual territories, base {BASE[0]} {BASE[1]}")

    # availability: every territory, plus new ones as Apple adds them
    try:
        call("POST", "/v1/inAppPurchaseAvailabilities", {"data": {
            "type": "inAppPurchaseAvailabilities",
            "attributes": {"availableInNewTerritories": True},
            "relationships": {
                "inAppPurchase": {"data": {"type": "inAppPurchases", "id": iid}},
                "availableTerritories": {"data": [{"type": "territories", "id": t["id"]} for t in territories]}}}})
        print(f"available in {len(territories)} territories")
    except RuntimeError as e:
        if "409" not in str(e):
            raise
        print("availability already set")

    if len(sys.argv) > 2 and sys.argv[1] == "--screenshot":
        path = sys.argv[2]
        payload = open(path, "rb").read()
        old = call("GET", f"/v2/inAppPurchases/{iid}/appStoreReviewScreenshot").get("data")
        if old:
            call("DELETE", f"/v1/inAppPurchaseAppStoreReviewScreenshots/{old['id']}")
        res = call("POST", "/v1/inAppPurchaseAppStoreReviewScreenshots", {"data": {
            "type": "inAppPurchaseAppStoreReviewScreenshots",
            "attributes": {"fileSize": len(payload), "fileName": os.path.basename(path)},
            "relationships": {"inAppPurchaseV2": {"data": {"type": "inAppPurchases", "id": iid}}}}})["data"]
        upload_parts(res["attributes"]["uploadOperations"], payload)
        call("PATCH", f"/v1/inAppPurchaseAppStoreReviewScreenshots/{res['id']}", {"data": {
            "type": "inAppPurchaseAppStoreReviewScreenshots", "id": res["id"],
            "attributes": {"uploaded": True, "sourceFileChecksum": None}}})
        print("review screenshot uploaded")

    state = call("GET", f"/v2/inAppPurchases/{iid}")["data"]["attributes"]["state"]
    print("state:", state)


if __name__ == "__main__":
    main()

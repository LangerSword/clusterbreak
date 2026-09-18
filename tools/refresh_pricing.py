#!/usr/bin/env python3
"""
Refresh AWS pricing for the Clusterbreak deploy kit — one command, live sources.

On-demand: AWS Pricing API (GetProducts, EC2, Linux/shared/NA, ap-south-1).
Spot:      EC2 DescribeSpotPriceHistory snapshot (ap-south-1, latest per type).
Output:    sim/data/aws-pricing.json (vendored + timestamped, like the other
           generated data; the frontend reads it so costs are real, not typed
           in by hand).

Usage:  python3 tools/refresh_pricing.py
"""

import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "sim" / "data" / "aws-pricing.json"

INSTANCE_TYPES = ["g4dn.xlarge", "g5.xlarge", "g5.2xlarge", "g6.xlarge", "g6e.xlarge"]
REGION = "ap-south-1"
LOCATION = "Asia Pacific (Mumbai)"


def aws(*args: str) -> dict:
    out = subprocess.run(
        ["aws", *args, "--output", "json"], capture_output=True, text=True, timeout=120
    )
    if out.returncode != 0:
        raise RuntimeError(f"aws {' '.join(args[:3])} failed: {out.stderr.strip()[:300]}")
    return json.loads(out.stdout or "{}")


def on_demand_price(instance_type: str) -> float | None:
    data = aws(
        "pricing",
        "get-products",
        "--service-code",
        "AmazonEC2",
        "--region",
        "us-east-1",
        "--max-results",
        "1",
        "--filters",
        json.dumps(
            [
                {"Type": "TERM_MATCH", "Field": "instanceType", "Value": instance_type},
                {"Type": "TERM_MATCH", "Field": "location", "Value": LOCATION},
                {"Type": "TERM_MATCH", "Field": "operatingSystem", "Value": "Linux"},
                {"Type": "TERM_MATCH", "Field": "preInstalledSw", "Value": "NA"},
                {"Type": "TERM_MATCH", "Field": "tenancy", "Value": "Shared"},
                {"Type": "TERM_MATCH", "Field": "capacitystatus", "Value": "Used"},
            ]
        ),
    )
    for product in data.get("PriceList", []):
        p = json.loads(product)
        for term in p.get("terms", {}).get("OnDemand", {}).values():
            for dim in term.get("priceDimensions", {}).values():
                return float(dim["pricePerUnit"]["USD"])
    return None


def spot_prices() -> dict:
    data = aws(
        "ec2",
        "describe-spot-price-history",
        "--region",
        REGION,
        "--instance-types",
        *INSTANCE_TYPES,
        "--product-descriptions",
        "Linux/UNIX",
        "--max-items",
        "200",
    )
    latest: dict[str, float] = {}
    for row in data.get("SpotPriceHistory", []):
        it = row["InstanceType"]
        price = float(row["SpotPrice"])
        if it not in latest or price < latest[it]:
            latest[it] = price
    return latest


def main() -> int:
    prices = {}
    for it in INSTANCE_TYPES:
        try:
            on_demand = on_demand_price(it)
            print(f"{it:14s} on-demand ${on_demand}/hr" if on_demand else f"{it}: no on-demand row")
            prices[it] = {"onDemandUsdPerHour": on_demand}
        except Exception as e:
            print(f"{it}: failed — {e}", file=sys.stderr)
            prices[it] = {"onDemandUsdPerHour": None}
    try:
        spot = spot_prices()
    except Exception as e:
        print(f"spot fetch failed: {e}", file=sys.stderr)
        spot = {}
    for it, info in prices.items():
        info["spotUsdPerHour"] = spot.get(it)
        print(f"{it:14s} spot (min snapshot) ${spot.get(it)}/hr")

    doc = {
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "region": REGION,
        "location": LOCATION,
        "source": "AWS Pricing API (on-demand, ap-south-1, Linux/shared) + EC2 DescribeSpotPriceHistory (spot: one-zone minimum at fetch time; spot moves constantly)",
        "instances": prices,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=2) + "\n")
    print(f"\nwrote {OUT.relative_to(ROOT)}")
    return 0 if any(v.get("onDemandUsdPerHour") for v in prices.values()) else 1


if __name__ == "__main__":
    sys.exit(main())

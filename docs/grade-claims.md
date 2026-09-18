# Claim grade — Clusterbreak (deterministic grader)

*Run: 2026-09-18 01:10 UTC · grader: `tools/grade_claims.py` · method: recompute-from-sources + live re-fetch + suite runs + negative controls.*

| Dimension | Score |
|---|---|
| D1 internal-integrity | 5/5 |
| D2 live-freshness | 2/2 |
| D3 reproduction | 3/3 |
| D4 honesty-contract | 3/3 |
| **overall** | **13/13** |

## Failures

- none

## Negative controls

- 5% efficiency corruption: caught
- fitted device missing from catalog: caught
- 3% size drift vs live API: caught

## Notes (scope honesty)

- Graded: data integrity, live freshness, anchor reproduction, shipped honesty markers.
- Not graded here: UI visual quality; behavioral flows (see `tools/browser/`); device bandwidth provenance is vendor-page curated and not re-fetched.
- fitted devices: 15 · models with all three sizes: 6/8

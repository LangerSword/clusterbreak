# Site grade — Clusterbreak (deterministic grader)

*Run: 2026-09-20 13:12 UTC · grader: `tools/grade_site.py` · target: deployed site.*

| | |
|---|---|
| checks | **31/31** |
| negative controls | **14/14 caught** |

## Failures

- none

## Scope honesty
- Graded: deployed page availability, shipped-data authenticity, no hardcoded stat literals, docs↔backend endpoint parity, grade-claim parity, engine markers, legacy link forwarding, DESIGN.md↔site.css token sync, hero asset integrity + animation honesty, icon/emoji parity, simulator↔landing navigation, both test suites.
- Not graded here: visual quality (see the visual-QA audit + screenshots), Lighthouse/Core Web Vitals, screen-reader traversal.

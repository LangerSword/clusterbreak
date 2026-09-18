# Security grade — Clusterbreak

*Run: 2026-09-18 03:10 UTC · grader: `tools/grade_security.py` · artifact: `/tmp/cb-template.yaml`*

| | |
|---|---|
| checks | **12/12** |
| negative controls | **2/2 caught** |

## Failures

- none

## Warnings (accepted, documented)

- SshCidr defaults to 0.0.0.0/0 (documented; the deploy command in the UI passes your IP)

## Skipped (unavailable)

- none

## Scope honesty
- Graded: repo secrets hygiene, generated-template posture, live API input boundary, our AWS least-privilege.
- NOT graded here: the model's numerical accuracy (see `grade_claims.py`), UI quality, browser behavior (`tools/browser/`), AWS-side runtime hardening after deploy (SG drift, patch state).
- Threat model that matters here: no user credentials ever transit our system (deploys run in the user's own account via their own CLI); the public API stores only bounded non-secret report JSON.

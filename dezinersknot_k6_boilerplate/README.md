# DezinersKnot k6 Load Testing

k6 + JavaScript load test suite for the DezinersKnot marketplace API.

## Credentials

No passwords are stored in this repo. Every scenario reads them from the
environment and will return 401 without them:

```
k6 run -e CLIENT_PASSWORD=... -e DESIGNER_PASSWORD=... scenarios/clientLogin.js
k6 run -e ACTOR_PASSWORD=...                            scenarios/journeyLoad.js
```

Also available: `BASE_URL`, `CLIENT_EMAIL`, `DESIGNER_EMAIL`, `ADMIN_EMAIL`,
`ADMIN_PASSWORD`. Default environment is `https://qa.dezinersknot.com/api`.

## Layout

```
config/     BASE_URL and account defaults
data/       payloads.js (request bodies) - testData.js / actors.js (accounts)
flows/      one function per API, grouped by role
scenarios/  what to run and at what load
utils/      helpers (checks, extraction) - metrics - summary
scripts/    report.js (HTML) - check-thresholds.js (CI gate)
```

## Scenarios

**Functional** (1 VU / 1 iteration) - one per step of
`docs/IMPLEMENTATION_ORDER.md`: `clientLogin.js`, `createOpportunity.js`,
`sendProposal.js`, `acceptContract.js`, and so on. Correlated ids are passed
in, e.g. `-e CONTRACT_ID=719 -e MILESTONE_ID=2134`.

**Load** (ramped): `clientLoad.js`, `opportunityLoad.js`, `proposalLoad.js`,
`journeyLoad.js`. These log in ONCE in `setup()` and share the tokens - see
the rate limit below for why that is mandatory, not just tidier.

**End to end**: `e2eLoad.js` at 1 VU, for functional validation of the whole
chain. Two gates guard the tail:

```
-e ALLOW_PAYMENT=true    creates a REAL Cashfree order
-e PAYMENT_MODE=full     steps after payment; needs a SETTLED payment,
                         which requires Cashfree's hosted checkout
```

Without them the run stops cleanly after `add_milestone` and says why.

## Reporting

```
k6 run scenarios/journeyLoad.js     -> results/<name>.json + text summary
node scripts/report.js              -> reports/<name>.html
node scripts/check-thresholds.js    -> PASS/FAIL gate, non-zero exit on failure
```

`results/` and `reports/` are gitignored; regenerate them from a run.

## QA rate limit - read before choosing a VU count

QA enforces a rate limit that is **global per IP, not per endpoint**. A read
that creates nothing is throttled by the same budget as a write. Measured
2026-09-07 with a constant-arrival-rate probe on a GET endpoint:

| Offered | Accepted | 429s |
|---------|----------|------|
| 5/s     | 5.0/s    | 0    |
| 10/s    | 10.0/s   | 0    |
| 12/s    | 10.7/s   | 11%  |
| 15/s    | 10.8/s   | 26%  |
| 20/s    | 13.3/s   | 29%  |

**~10 requests/sec is the clean ceiling.** Past it, accepted throughput
flatlines around 11-13/s and the surplus becomes
`429 {"error":"Too many requests. Please try again in 60 seconds."}`.

Login is limited more tightly still (about 15 requests per 60s), which is why
load scenarios must authenticate once in `setup()` rather than per iteration.

The journey costs 7 requests per iteration, so at ~10/s the ceiling is roughly
1.4 journeys/sec - about **3-4 VUs**. Runs at 50 and 150 VUs collapsed to 17%
and 6% success respectively; that is the limiter, not application capacity.

Open question for the backend team: is this limiter intentional on QA, can it
be raised or IP-whitelisted for a scheduled window, and does production carry
the same limit?

## Notes

- Success is NOT `status === 2xx`. These controllers answer HTTP 200 with an
  `errors` key when a write did not happen, so `isWriteOk()` in
  `utils/helpers.js` requires a 2xx AND the absence of `errors` / `error` /
  `success: false`. Grading on status alone reports ~100% success while
  creating nothing.
- Thresholds go on Rates, not Trends. A Trend that matched zero samples is
  indistinguishable from one whose samples are all zero, and k6 reports an
  unevaluated threshold as PASS. `utils/summary.js` flags those as UNVERIFIED.
- Load scenarios write real records to QA. Budget the ramp accordingly.

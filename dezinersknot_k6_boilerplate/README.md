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

**Steady lifecycle profiles**: `steadyLoad.js` runs complete client/designer
journeys with user think time. It uses a `ramping-vus` executor so the number
of concurrent users is controlled by stages. `VUS` is the peak user count for
`load`, `concurrency`, and `stress` (and the exact held count for
`concurrency`). For `spike`, `SPIKE_VUS` is the peak and defaults to `VUS`.
`DURATION` is the hold duration.

```
# Expected peak load (default): 15 -> 30 -> 60 concurrent user journeys
k6 run scenarios/steadyLoad.js

# Hold exactly 60 concurrent user journeys after a short ramp
k6 run -e TEST_TYPE=concurrency -e VUS=60 -e DURATION=30m scenarios/steadyLoad.js

# Find the limit gradually; choose a VUS peak above expected production traffic
k6 run -e TEST_TYPE=stress -e VUS=120 -e DURATION=10m scenarios/steadyLoad.js

# Burst from a 15-VU baseline to 120 VUs for one minute, then recover
k6 run -e TEST_TYPE=spike -e BASELINE_VUS=15 -e SPIKE_VUS=120 \
  -e DURATION=5m -e SPIKE_DURATION=1m scenarios/steadyLoad.js
```

The profiles are deliberately separate: normal `load` and `concurrency` runs
answer whether the system meets its expected simultaneous-user target;
`stress` finds the degradation point; `spike` measures sudden burst handling
and recovery. For the normal profiles, new VUs are spread over 60 seconds to
avoid an accidental request burst. Spike runs default to no start staggering;
set `START_STAGGER_SECONDS` explicitly if that is not desired.

These are workflow-concurrency tests, not raw request-rate tests: each VU
performs a seven-request journey over the default five-minute lifecycle. They
are suitable for expected-load, concurrent-session, gradual-stress, and
sudden-burst behaviour. Use a separate `constant-arrival-rate` scenario when
the question is API throughput or a specific requests-per-second limit. Also,
the supplied five actor pairs are reused across VUs; add enough isolated actor
pairs before treating a high-VU run as distinct-account concurrency.

### Full workflow including sandbox payment and work submission

`steadyLoad.js` can run the complete positive journey through designer work
submission only against Cashfree **sandbox**. It creates a marketplace payment
order, uses Cashfree's S2S `Order Pay` API with sandbox test-card values, waits
for the order to settle, verifies it with the marketplace, activates the
milestone, then submits the designer's work. It is deliberately unavailable
unless all of these settings are supplied by a secret store:

```
CASHFREE_SETTLEMENT=s2s-card
CASHFREE_SANDBOX=true
CASHFREE_SANDBOX_CLIENT_ID=...
CASHFREE_SANDBOX_CLIENT_SECRET=...
CASHFREE_TEST_CARD_NUMBER=...
CASHFREE_TEST_CARD_EXPIRY_MM=...
CASHFREE_TEST_CARD_EXPIRY_YY=...
CASHFREE_TEST_CARD_CVV=...
# Only when Cashfree enables headless OTP for the sandbox account:
CASHFREE_TEST_CARD_OTP=...
```

The Cashfree sandbox account must have S2S enabled; plain-card S2S payment also
needs Cashfree's PCI approval. If the selected test card requires OTP, enable
Cashfree headless OTP and set `CASHFREE_TEST_CARD_OTP`. Do not use live
credentials or real card data.
With those requirements met, run a one-user smoke test first, then a staged
load profile:

```
k6 run -e ACTOR_PASSWORD=... -e ALLOW_PAYMENT=true -e PAYMENT_MODE=full \
  -e CASHFREE_SETTLEMENT=s2s-card -e CASHFREE_SANDBOX=true \
  -e CASHFREE_SANDBOX_CLIENT_ID=... \
  -e CASHFREE_SANDBOX_CLIENT_SECRET=... -e CASHFREE_TEST_CARD_NUMBER=... \
  -e CASHFREE_TEST_CARD_EXPIRY_MM=... -e CASHFREE_TEST_CARD_EXPIRY_YY=... \
  -e CASHFREE_TEST_CARD_CVV=... -e CASHFREE_TEST_CARD_OTP=... \
  -e TEST_TYPE=concurrency -e VUS=1 \
  -e DURATION=5m scenarios/steadyLoad.js
```

If Cashfree returns a pending/OTP/redirect response instead of `SUCCESS`, the
iteration is recorded as incomplete and stops before verification or work
submission. Do not treat that as a successful end-to-end flow.

### Cashfree integration observed in this repository

The k6 client calls these DK APIs; their request and response handling is
implemented in `flows/clientFlow.js` and `data/payloads.js`:

| Stage | DK API | Correlated data observed in this repository |
| --- | --- | --- |
| Create order | `POST /bx_block_cfdesignersidecontractmanagement/client_contracts/payment_from_cashfree` | body: `data.attributes.contract_id`, `data.attributes.milestone_id`; response: `cashfree_order.order_id`, and `payment_session_id` either top-level or inside `cashfree_order` |
| Verify payment | `POST /bx_block_cfdesignersidecontractmanagement/client_contracts/verify_cashfree_payment` | body: `order_id` |
| Activate milestone | `PUT /bx_block_cfdesignersidecontractmanagement/client_contracts/activate_milestone/` | body: contract and milestone ids |

No `cf_order_id` response field, Cashfree SDK call in the DK backend, webhook
endpoint, webhook signature rule, or payment-state database update is present
in this repository. Do not infer those details. The backend team must provide
the real sandbox webhook contract before it can be tested. The only admin API
in the suite is a payment-stats read; it is not a correlated payout flow.

### Controlled payment sandbox workload

`scenarios/paymentSandboxLoad.js` dynamically creates a unique opportunity,
proposal, contract (including its offered milestones), and order per iteration.
It reads the offered milestone from DK's existing `combined_milestones` response
instead of calling the retired add-milestone action. It has two modes:

- `PAYMENT_MODE=order-only` exercises DK order creation only. It does not
  claim the payment or webhook succeeded.
- `PAYMENT_MODE=sandbox` uses the existing explicit S2S sandbox adapter,
  verifies payment with DK, then activates the milestone, submits work, reviews
  it, and approves it. It is blocked unless the sandbox-only credentials and
  test-card settings are supplied by a secret store.

Preferred configuration names are `PAYMENT_ENABLED=true`,
`PAYMENT_MODE=order-only|sandbox`, `CASHFREE_ENV=sandbox`,
`PAYMENT_CONCURRENCY`, and `PAYMENT_RATE`. `ALLOW_PAYMENT` and
`CASHFREE_SANDBOX` remain supported for older scripts. `PAYMENT_RATE=0` uses
bounded concurrency; a positive rate uses a `constant-arrival-rate` executor
and must be a whole number of journey starts per second.

The payment scenario records `payment_order_*`, `payment_status_*`,
`payment_workflow_*`, `payment_success_rate`, Cashfree sandbox payment metrics,
and separate `http_2xx`, `http_4xx`, `http_429`, `http_5xx`, timeout, and
transport-error counters. It never logs response bodies, session ids, secrets,
headers, card data, or CVVs.

Small order-creation smoke test (no Cashfree card credentials required):

```
k6 run -e ACTOR_PASSWORD=... -e PAYMENT_ENABLED=true \
  -e CASHFREE_ENV=sandbox -e PAYMENT_MODE=order-only \
  -e PAYMENT_CONCURRENCY=1 -e PAYMENT_DURATION=20s \
  -e PAYMENT_START_STAGGER_SECONDS=0 scenarios/paymentSandboxLoad.js
```

Small positive sandbox smoke test (all values must come from a secret store):

```
k6 run -e ACTOR_PASSWORD=... -e PAYMENT_ENABLED=true \
  -e PAYMENT_MODE=sandbox -e CASHFREE_ENV=sandbox \
  -e PAYMENT_CONCURRENCY=1 -e PAYMENT_ITERATIONS=1 -e PAYMENT_DURATION=2m \
  -e PAYMENT_START_STAGGER_SECONDS=0 -e CASHFREE_SETTLEMENT=s2s-card \
  -e CASHFREE_SANDBOX_CLIENT_ID=... -e CASHFREE_SANDBOX_CLIENT_SECRET=... \
  -e CASHFREE_TEST_CARD_NUMBER=... -e CASHFREE_TEST_CARD_EXPIRY_MM=... \
  -e CASHFREE_TEST_CARD_EXPIRY_YY=... -e CASHFREE_TEST_CARD_CVV=... \
  scenarios/paymentSandboxLoad.js
```

If the selected sandbox method returns OTP or a pending result, configure the
existing optional `CASHFREE_TEST_CARD_OTP` only when the merchant account has
the required headless sandbox capability. Otherwise stop at order creation and
perform the hosted checkout manually; k6 cannot reliably drive that browser UI.

For a low, controlled sandbox run, start at five concurrent payment journeys
with a ten-second cooldown, then increase one variable at a time. Use
`PAYMENT_RATE=1` before trying `5`, `10`, `25`, or higher. Treat 429s and
Cashfree failures as a separate payment-provider constraint, not DK capacity.

### 150 client + 150 designer application lifecycle load

`scenarios/applicationLifecycleLoad.js` is a no-payment application workload.
One k6 VU executes one fully correlated client/designer pair, so **150 k6
lifecycle-pair VUs represent 300 logical users**: 150 client users and 150
designer users. This keeps the opportunity, proposal, contract, and milestone
within the same correlated journey; splitting the two roles into unrelated VU
pools would require an external shared-data queue that this repository does not
contain.

The 300-user run needs 150 isolated QA client/designer pairs in `data/actors.js`
and a rate-limit-approved login window. The known QA limiter will otherwise
reject setup logins and business requests:

```
k6 run -e ACTOR_PASSWORD=... -e LIFECYCLE_PAIR_VUS=150 \
  -e LIFECYCLE_RAMP_DURATION=15m -e LIFECYCLE_HOLD_DURATION=30m \
  -e LOGIN_RATE_LIMIT_APPROVED=true scenarios/applicationLifecycleLoad.js
```

Do not use this command until QA has enough isolated accounts and the IP is
whitelisted or its limiter is raised. It exercises DK lifecycle capacity; run
`paymentSandboxLoad.js` separately so Cashfree Sandbox limits are not mistaken
for DK performance.

**End to end**: `e2eLoad.js` at 1 VU, for functional validation of the whole
chain. Two gates guard the tail:

```
-e ALLOW_PAYMENT=true    creates a REAL Cashfree order
-e PAYMENT_MODE=full     steps after payment; needs a SETTLED payment,
                         which requires Cashfree's hosted checkout
```

Without them the run stops cleanly after it resolves an offered milestone and
says why.

## Reporting

```
k6 run scenarios/journeyLoad.js     -> results/<name>.json + results/<name>.html + text summary
node scripts/report.js              -> optional detailed reports/<name>.html
node scripts/check-thresholds.js    -> PASS/FAIL gate, non-zero exit on failure
```

Every scenario uses the shared summary writer, so its HTML report is generated
automatically beside the JSON result. `results/` and `reports/` are gitignored;
regenerate them from a run.

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

# API Implementation Order

1. Client Login
2. Client Profile
3. Create Opportunity
4. Find Opportunities
5. Designer Login
6. Designer Opportunity List
7. Send Proposal
8. Pending Contract Offers
9. Client Offer/Contract
10. Designer Accept Contract
11. Client Activate Contract
12. Read Offered Milestone
13. Payment
14. Verify Payment
15. Activate Milestone
16. Designer Submit Work
17. Client Contract Details / Review
18. Admin payout/payment APIs

CORRECTED 2026-09-04: Activate Milestone was previously listed at 13, before
Payment. That order cannot work - the server rejects it with

    422 {"error":"This milestone has not been funded yet.
                  Please complete the payment before activating it."}

Payment must precede milestone activation. Verified against QA.

The offer request in `data/payloads.js` contains the milestones. Composite
journeys must read the offered milestone through the contract-milestone list
endpoint; they must not call the retired add-milestone action.

## Where automation stops

Steps 1-12 run unattended. Step 13 creates a real Cashfree order and returns a
payment_session_id, but the authorisation happens inside Cashfree's hosted JS
SDK, which k6 cannot drive. So steps 14-17 are only reachable once a human has
completed the checkout for that order.

Running them against an unsettled payment measures an error path, not
throughput. scenarios/e2eLoad.js therefore gates them:

    -e ALLOW_PAYMENT=true    step 13 (real money - approved sandbox only)
    -e PAYMENT_MODE=full     steps 14-17 (needs a settled payment)

## Correlation

Login -> token (meta.token); Opportunity -> opportunity_id; Proposal ->
proposal_id; Contract -> contract_id; Milestone -> milestone_id; Payment ->
cashfree_order.order_id (which is what Verify Payment takes, NOT the contract
id).

## QA constraints

Login is rate limited to 15 requests per 60 seconds, PER IP rather than per
account - a pool of accounts does not raise the ceiling. Any load scenario must
log in once in setup() and reuse the token; logging in per iteration produces
429s, not a capacity measurement. Verified 2026-09-04.

Alternative paths: contract decline, request edit, accept/decline edits, work
changes and resubmission.

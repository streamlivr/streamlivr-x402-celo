# Architecture and invariants

This document is the engineering detail behind the README: what each module owns, which
invariants hold, and how failures are handled.

## Module boundaries

| Module | Owns | Must never do |
|---|---|---|
| `src/x402/config.ts` | Network, asset, decimals, EIP-712 domain, attribution codes, fee currency | Guess an address; accept a mismatched network/asset pair |
| `src/x402/facilitator.ts` | Hosted facilitator HTTP client and API-key auth headers | Log or forward the API key |
| `src/x402/fastifyAdapter.ts` | Translating a Fastify request into the x402 adapter contract | Mutate the request |
| `src/x402/split.ts` | 60/40 split arithmetic in bigint, remainder assignment | Use floating point |
| `src/x402/payoutMath.ts` | Creator balances, reserving statuses, payout floor | Clamp a negative outstanding balance to zero |
| `src/x402/kyc.ts` | Payout eligibility policy: the four gates, the blocker list, the local-override rule | Touch a database, read an environment variable, or import anything |
| `demo/server.ts` | A runnable seller with in-memory persistence | Represent production durability |
| `reference/admin-payout-routes.ts` | Production prepare/approve/execute/reconcile flow | Be imported without the private application around it |
| `reference/local-kyc-override.ts` | The development-only switch that marks a creator verified | Act in a production-configured process |

The payment layer deliberately does not own the **resource**: the route handler returns data,
and the x402 layer wraps it. That keeps the protocol concern out of query code and makes the
paid endpoints testable with a plain HTTP request.

## Invariants

1. **One asset, one network, one address.** `resolveX402Asset` throws unless the asset is
   settleable on the configured network and the address is the canonical one. There is no path
   where a mainnet wallet is paired with a testnet asset.
2. **Atomic money only.** Amounts are decimal strings in token base units. Every comparison,
   sum and split is `bigint`. A payout balance can exceed `Number.MAX_SAFE_INTEGER` without
   losing a unit.
3. **Attribution comes from the response, not the request.** The buyer's creator ID, if any, is
   ignored. Only rows the endpoint actually returned (after consent filtering) are attributed.
4. **Shares sum exactly to the pool.** The integer remainder is handed out in response order,
   so the creator shares always add up to `floor(amount * 6000 / 10000)`.
5. **A settled payment is never charged twice.** The signed payload hash is the idempotency key.
   A replay re-emits the stored `payment-response` header instead of asking for settlement.
6. **A submitted payout is never silently re-sent.** The transaction hash is persisted before
   confirmation is awaited; a timeout leaves the row `SUBMITTED` for reconciliation, not
   `FAILED` for retry.
7. **The tag is written at send time.** ERC-8021 suffixes are appended to the calldata of every
   transaction this codebase signs. There is no backfill path because the standard has none.
8. **Eligibility has one definition.** Prepare and execute both ask `payoutBlockers` in
   `src/x402/kyc.ts`, so the two steps cannot drift apart on who is payable. Prepare reports the
   creators it skipped together with the gate that blocked each one.
9. **Production eligibility comes from the provider.** `User.kycStatus` is written by the ramp
   provider's webhook and its reconcile worker. The development switch that bypasses that is
   refused whenever `NODE_ENV=production` or the provider environment is production, so the code
   path cannot reach a deployment.

## Failure modes

| Failure | Behaviour |
|---|---|
| Facilitator rejects verification | Buyer receives the facilitator's error status and body; no settlement row is written |
| Settlement succeeds, local write fails | Record is queued: Postgres outbox first, Redis list as a fallback, in-process map as a last resort; the paid response is still returned |
| Persistence keeps failing | Row moves `PENDING -> RETRYING -> FAILED` with exponential backoff (cap 12 attempts), and `FAILED` is terminal and visible to admins |
| Duplicate signed payload | Served from the stored settlement with the original header |
| Payout broadcast throws | Row is released to `FAILED` because the transfer never left the treasury |
| Payout broadcast succeeds, confirmation times out | Row stays `SUBMITTED` with its hash; `reconcile` resolves it from the chain |
| Payout has no hash and is older than 10 minutes | `reconcile` releases it to `FAILED` with an explicit instruction to check the treasury nonce first |
| Creator's verified wallet changes between approval and send | Execution aborts with `409`; a new payout must be prepared |
| Creator fails one of the four eligibility gates | `prepare` creates no row for them and lists the creator, the outstanding amount and the failing gates in `skipped` |
| Local override attempted in a production-configured process | Refused with `403`; the stored provider status is the only thing the gate will read |
| Two API instances both try to send | Not safe: in-process serialization only. A distributed lock is required before scaling out |

## Why a durable outbox exists

The dangerous window is: the facilitator settles on-chain, then the process dies before the
local accounting write. Retrying the request cannot fix that, because the authorization nonce is
already spent. So the settlement record is written to a durable queue and retried until it
lands, while the buyer still receives the data they paid for. `FAILED` rows are deliberately
terminal so an operator sees them instead of an infinite silent retry loop.

## Reporting and reconciliation

Production surfaces (not reproduced here) include settled volume, platform and creator shares,
treasury receipts with transaction hashes, outbox health by status, payout totals by status, and
per-creator outstanding balances. Reporting queries filter by `createdAt`, which is why the
production schema carries single-column `createdAt` indexes in addition to the composite
`(endpoint, createdAt)` and `(creatorId, createdAt)` ones.

The next reconciliation step is a scheduled job that compares stored settlement hashes against
the treasury wallet's on-chain transfer history and alerts on drift. That job is specified but
not included here, because it requires the production database.

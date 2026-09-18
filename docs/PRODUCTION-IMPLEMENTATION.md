# Streamlivr x402 Payments on Celo

This document is the implementation reference for accepting x402 payments on Celo
with the Streamlivr backend as the seller/resource server.

## Scope of the first implementation

The current seller slice exposes these paid endpoints:

```text
GET /api/v1/agent/ping
GET /api/v1/agent/listings
GET /api/v1/agent/catalog
GET /api/v1/agent/creator/:id
```

Prices are fixed in Celo USDC base units:

| Endpoint | Price | Creator data rule |
|---|---:|---|
| `/api/v1/agent/ping` | `10000` ($0.01) | No creator attribution |
| `/api/v1/agent/listings` | `10000` ($0.01) | `listings` consent, public profiles only |
| `/api/v1/agent/catalog` | `10000` ($0.01) | `catalog` consent, public-ready videos only |
| `/api/v1/agent/creator/:id` | `5000` ($0.005) | `profile` consent, public profile only |

Creator consent is changed with an authenticated request:

```http
PATCH /api/v1/agent/consent
Authorization: Bearer <Streamlivr JWT>
Content-Type: application/json

{"listings":true,"catalog":true,"profile":true}
```

Send `{"revoke":true}` to disable all four consent flags immediately. Consent is
not inferred from a wallet, a buyer request, or a creator ID supplied by a client.

The route uses Celo Sepolia USDC, the official hosted Celo facilitator, and a
Streamlivr-owned Celo wallet as `payTo`. It records every successful settlement in
the `X402Payment` table before the paid response is returned.

Creator-facing data is default-off. Creators manage consent through the authenticated
`PATCH /api/v1/agent/consent` route. A missing or revoked consent record excludes the
creator from agent listings/catalog/profile responses.

## Official Celo choices

Use the official Celo hosted facilitator and the scoped x402 v2 packages:

```text
@x402/core
@x402/evm
@x402/hono
@x402/fetch   (buyer/agent client only)
viem
```

Do not use the legacy unscoped `x402-express` / `x402-fetch` packages, or the v1
`paymentMiddleware(payTo, routes, facilitator)` call shape. Celo is not in the legacy
network enum. The scoped `@x402/fetch` package is the current v2 buyer client.

Pin the scoped packages to the same minor line. `@x402/fetch` resolves its own
`@x402/core`, so mixing minors (for example `@x402/fetch@2.26` with
`@x402/core@2.25`) loads two copies of the protocol types; `npm ls @x402/core` must
report a single deduped version per major.

### Testnet

```text
CAIP-2 network: eip155:11142220
Facilitator:   https://api.x402.sepolia.celo.org
RPC:           https://forno.celo-sepolia.celo-testnet.org
Explorer:      https://celo-sepolia.blockscout.com
USDC:          0x01C5C0122039549AD1493B8220cABEdD739BC44E
Decimals:      6
```

### Mainnet

```text
CAIP-2 network: eip155:42220
Facilitator:   https://api.x402.celo.org
RPC:           https://forno.celo.org
Explorer:      https://celoscan.io
USDC:          0xcebA9300f2b948710d2653dD7B07f33A8B32118C
Decimals:      6
```

The hosted facilitator supports USDC through EIP-3009. USDC is the right first
asset because it is supported on both Celo Sepolia and mainnet. Do not start with
USDm: the hosted facilitator currently expects EIP-3009, while USDm uses EIP-2612.

Amounts are strings in token base units:

```text
$0.005 = 5000
$0.01  = 10000
$1.00  = 1000000
```

## Payment flow

```text
1. Buyer requests the paid Streamlivr route.
2. Streamlivr returns HTTP 402 with explicit Celo USDC requirements.
3. Buyer signs an EIP-3009 authorization.
4. Buyer retries with the x402 payment header.
5. Streamlivr sends the payload to the hosted Celo facilitator.
6. Facilitator verifies and settles the authorization.
7. Facilitator-sponsored settlement transfers USDC buyer -> X402_PAY_TO.
8. Streamlivr persists the settlement and returns the paid response.
```

The facilitator does not custody Streamlivr funds. `X402_PAY_TO` is the Streamlivr
treasury wallet that receives USDC directly on Celo.

### Replay handling

`paymentRequestId` is a SHA-256 hash of the full signed x402 payload. Before
settlement the server looks up `(network, paymentRequestId)`; when a settlement row
already exists it serves the paid response and re-emits the stored
`payment-response` header instead of asking the facilitator to settle again. This
makes a client retry after a timed-out response idempotent rather than a second
charge, and matches the fact that the underlying EIP-3009 authorization nonce is
single-use.

## Creator Celo wallet verification

Payouts are only sent to an address the creator has proven they control. The
address is never taken from a request body without a signature.

```text
POST /api/v1/agent/wallet/challenge   { "address": "0x..." }
POST /api/v1/agent/wallet/verify      { "nonce": "<uuid>", "signature": "0x..." }
GET  /api/v1/agent/earnings
```

Both routes require the normal Streamlivr JWT. `challenge` issues a 10-minute
nonce-bound message and clears that creator's expired challenges; `verify`
recovers the signer with EIP-191 `personal_sign` and, on success, consumes the
challenge and upserts the `CELO` row in `UserWallet`. A challenge is single-use, so
a captured signature cannot be replayed. Checksum casing is normalised with
`getAddress` before storage.

A wallet that is already linked to a different Streamlivr account is rejected with
`409` rather than silently moved, so two accounts cannot point payouts at one
address.

`GET /api/v1/agent/earnings` returns the creator's own attributed total, reserved
amount, confirmed payouts, outstanding balance, consent flags, and the last 100
payout rows. It uses the same `src/x402/payoutMath.ts` helpers as admin payout
preparation, so a creator can never see a balance different from the one that gets
paid. That module is unit tested for reserving statuses, failures releasing
balance, oversized reservations staying negative, and atomic precision above
`Number.MAX_SAFE_INTEGER`.

## Creator payouts

Attribution records what each creator earned; payouts move the money. The flow is
deliberately two-person: `prepare` computes balances, `approve` authorises a row,
and `execute` broadcasts. All three require `SUPER_ADMIN`, and every step writes an
`AdminAuditLog` entry.

```text
GET  /api/v1/admin/x402/payouts
GET  /api/v1/admin/x402/creators
POST /api/v1/admin/x402/payouts/prepare      { "batchKey"?, "minimumAtomic"? }
POST /api/v1/admin/x402/payouts/:id/approve
POST /api/v1/admin/x402/payouts/:id/execute
POST /api/v1/admin/x402/payouts/:id/reconcile
POST /api/v1/admin/x402/payouts/:id/cancel
POST /api/v1/admin/x402/creators/:id/kyc/refresh
POST /api/v1/admin/x402/creators/:id/kyc/local-verify   (development only)
```

Rules enforced by the backend:

- `prepare` only creates rows for creators who are `kycStatus: VERIFIED`, not
  fraud-suspended, below the fraud risk threshold, and have a verified primary
  `CELO` wallet. It ignores the historical `creatorWalletAddress` snapshot. The
  four gates come from `src/x402/kyc.ts`, the same module `execute` reads, and a
  creator who fails one is returned in the response's `skipped` array with the
  failing gates and a sentence for each.
- `kycStatus` is not operator-editable in production. It holds the ramp provider's
  answer, written by its signed webhook and refreshed by a five-minute reconcile
  worker, and the payout path reads the stored value instead of calling the
  provider inline. `GET /x402/creators` returns the status, whether it came from
  the provider or from the local switch, and every blocker per creator, which is
  what the admin Finance page renders. The refresh route pulls one creator's
  status on demand, without waiting for the worker.
- `X402_LOCAL_KYC_OVERRIDE` exists for local testing only. It is off by default
  and `src/x402/kyc.ts#localKycOverrideAllowed` refuses it when `NODE_ENV` is
  production or the Busha environment is production, so a copied env file cannot
  hand out payout eligibility in a deployment.
- Outstanding balance is `sum(X402Attribution.shareAtomic)` minus every payout in
  `PENDING`, `APPROVED`, `SUBMITTED`, or `CONFIRMED`. Failed and cancelled rows
  release the balance.
- The transfer amount is an atomic string; no floating-point arithmetic touches a
  balance.
- `execute` re-checks the same four gates plus the verified wallet, then atomically
  claims the row (`APPROVED` -> `SUBMITTED`). A second caller loses the claim, and
  a creator whose eligibility changed since the batch was prepared gets a `409`
  naming the gate rather than a transfer.
- Treasury sends are serialized in-process so two payouts cannot be assigned the
  same account nonce. **Scaling the API past one instance requires replacing this
  with a distributed lock before enabling payouts.**
- The transaction hash is persisted before confirmation is awaited. A confirmation
  timeout leaves the row `SUBMITTED` with its hash instead of `FAILED`, so an
  on-chain transfer can never be silently re-sent.
- `reconcile` reads the receipt for a `SUBMITTED` row: present and successful ->
  `CONFIRMED`, present and reverted -> `FAILED`, absent -> still pending. A row with
  no hash is only released to `FAILED` after the claim is older than ten minutes.

This is a custodial hot-wallet flow: keep the payout wallet separate from
`X402_PAY_TO`, fund it only with the amount being paid out plus gas, and treat
`X402_TREASURY_PRIVATE_KEY` as a high-value secret. Mainnet payouts should move to a
signer outside the API process (KMS or hardware signer) before real volume.

## Admin visibility

`GET /api/v1/admin/revenue/overview` (ANALYST and above) returns an `x402` block
alongside the existing revenue surfaces, and the platform-share figure is included
in `total.revenueUsd`:

- settled payment count, gross atomic/USD volume, platform and creator shares
- volume grouped by endpoint
- treasury receipts (settlement hash, `payTo`, network, amount, timestamp)
- outbox health: `PENDING`, `RETRYING`, `FAILED`, `COMPLETED`
- payout totals by status
- per-creator outstanding balances after reserved and confirmed payouts

The Finance page renders this as an x402 operations section with the existing
`Section`/`Card`/`StatCard`/`Table`/`Pill` primitives and semantic tokens. Analysts
see the read-only view; the payout prepare/approve/execute/reconcile/cancel controls
only render for `SUPER_ADMIN` and are enforced server-side regardless.

## Buyer / agent client

The buyer path lives in the backend so a signing key never reaches the mobile or
browser bundle:

```bash
cd backend
X402_BUYER_PRIVATE_KEY=0x... npm run x402:buyer-smoke
```

`src/scripts/x402-buyer-smoke.ts` builds an `x402Client`, pins `allowedAssets` to
Celo USDC with a per-payment cap, registers `ExactEvmScheme` for the configured
network, and wraps `fetch`. The wrapper performs the 402 -> sign -> retry loop and
returns the paid response. The script is a canary, not a production wallet: use a
dedicated low-balance testnet key.

## Required environment

The API key is created by a human at https://x402.celo.org. Connect an EVM wallet,
create the key, and store it only in the backend environment. Never send it to a
client or include it in a browser bundle.

```env
X402_ENABLED=true
X402_NETWORK=testnet
X402_API_KEY=x402_...
X402_PAY_TO=0xYourCeloSepoliaTreasury
X402_USDC_ADDRESS=0x01C5C0122039549AD1493B8220cABEdD739BC44E
X402_CHAIN_ID=11142220
X402_ASSET_DECIMALS=6
X402_PING_PRICE_ATOMIC=10000
# Settlement asset: USDC on both networks, USDT/USAT on mainnet only.
X402_SETTLEMENT_ASSET=USDC
# ERC-8021 attribution. Set before the first signed transaction; no backfill.
X402_ATTRIBUTION_TAG=
X402_ATTRIBUTION_CODES=
# Pay treasury gas in the settlement asset instead of CELO ("auto" = adapter).
X402_FEE_CURRENCY=
X402_BUYER_MAX_ATOMIC=10000
# Payout treasury (separate from X402_PAY_TO). Server-side only.
X402_TREASURY_PRIVATE_KEY=
X402_TREASURY_RPC_URL=https://forno.celo-sepolia.celo-testnet.org
# Buyer canary only. Never ship to a client bundle.
X402_BUYER_BASE_URL=http://localhost:3000
X402_BUYER_PRIVATE_KEY=
X402_BUYER_RPC_URL=https://forno.celo-sepolia.celo-testnet.org
```

For mainnet, change `X402_NETWORK`, `X402_PAY_TO`, `X402_USDC_ADDRESS`, and
`X402_CHAIN_ID` together. Never mix a mainnet wallet with a Sepolia asset or vice
versa.

## API and database boundaries

The x402 module owns:

- payment requirement construction through the official SDK
- facilitator authentication
- verification and settlement orchestration
- payment idempotency and settlement persistence
- settlement response headers

The normal Streamlivr route handler owns the resource response. Paid creator routes
filter at query time and attach creator IDs to the request internally. After successful
settlement, the x402 module writes `X402Attribution` rows from those returned IDs. The
creator pool is 60% of the atomic payment amount, split deterministically (with any
remainder assigned in response order); the remaining 40% is platform revenue. The
catalog exposes track metadata only; it does not expose preview or media URLs.

The durable payment record is separate from the existing Solana-oriented wallet
ledger. This avoids pretending that a Celo ERC-20 settlement has the same indexing
and accounting semantics as a Solana wallet sync.

Reporting queries filter `X402Payment` and `X402Attribution` by `createdAt` alone, so
`20260917120000_x402_reporting_indexes` adds single-column `createdAt` indexes; the
existing composite indexes lead with `endpoint` and `creatorId` and cannot serve
that range scan.

## Local verification sequence

1. Apply migrations in the deployment environment with `npx prisma migrate deploy`.
2. Install dependencies in `backend`.
3. Set `X402_ENABLED=false` for a free local route smoke test, or provide a real
   testnet `X402_API_KEY` for facilitator-backed tests.
4. Start the backend.
5. Request `/api/v1/agent/ping` without payment and confirm HTTP 402.
6. Use an x402 v2 buyer client with an explicit USDC spend-control allowance.
7. Fund the buyer with Celo Sepolia USDC from https://faucet.circle.com.
8. Retry the route and confirm HTTP 200.
9. Confirm the settlement transaction on Celo Sepolia Blockscout.
10. Confirm an `X402Payment` row contains the same transaction hash and, for a
    creator route, matching `X402Attribution` rows.
11. Run the buyer canary: `npm run x402:buyer-smoke`.
12. Verify creator payouts end to end on testnet: register a creator wallet through
    the challenge/verify routes, hit a creator-attributed paid route, then
    `prepare` -> `approve` -> `execute` the payout and confirm the recipient
    balance moved by the creator share (not the gross amount).

Commands that must pass before shipping a change to this module:

```bash
cd backend && npx prisma validate && npx prisma format --check
cd backend && npm run typecheck && npm run build && npx vitest run
cd admin   && npm run typecheck && npm run build
```

`npx prisma migrate diff` needs a shadow database; run it against a disposable
Postgres rather than assuming the local instance is available.

The facilitator's `/supported` endpoint should advertise x402 v2 for
`eip155:11142220` and the `eip2612GasSponsoring` extension.

## Safety rules

- Keep `X402_API_KEY` server-side.
- Use explicit asset addresses and EIP-712 metadata.
- Use integer atomic amounts, never floating-point balances.
- Persist settlement and attribution idempotently; temporary database failures are
  retried through `X402SettlementOutbox`.
- Never attribute a payment from buyer-supplied creator IDs.
- Derive later attribution from rows actually returned after consent filtering.
- Disable any demo consent-admin routes in production.
- Reconcile the `X402_PAY_TO` wallet against Celo RPC/indexer data.
- Alert on facilitator credit exhaustion, settlement failures, and treasury drift.
- Treat `SUBMITTED` payouts as live money: reconcile them, never re-send them.
- Keep `X402_TREASURY_PRIVATE_KEY` in a secret manager and out of logs, errors, and
  crash reports.

## Next implementation slices

1. Run a Sepolia canary with a funded buyer and a real facilitator API key, covering
   payment, attribution, wallet verification, and payout end to end.
2. Add a scheduled treasury reconciliation job that compares `X402Payment`
   settlement hashes against Celo transfer history and alerts on drift.
3. Move payout signing to a KMS/hardware signer and a distributed execution lock
   before running more than one API instance with payouts enabled.
4. Configure mainnet USDC only after the canary and treasury monitoring pass.

## Hackathon integration (Agents at Work)

This integration was built for the Celo "Agents at Work" hackathon. Four changes
were made specifically so it uses Celo primitives the way the event requires:

1. **Asset selection is no longer USDC-only.** `X402_SETTLEMENT_ASSET` accepts
   `USDC`, `USDT` and `USAT`, each with its canonical address, 6 decimals, and
   the correct EIP-712 domain (`USDT`/`USAT` report version `1`; `USDC` is `2`).
   `resolveX402Asset()` fails closed when the network, address or decimals do not
   match, and refuses USDT/USAT on Sepolia because the testnet facilitator only
   settles USDC. USAT is worth knowing about because the hackathon gives the
   highest stablecoin-adoption marks to USAT settled over x402.
2. **ERC-8021 attribution is applied to every transaction this API signs.**
   `X402_ATTRIBUTION_TAG` (the issued `celo_...` code) and
   `X402_ATTRIBUTION_CODES` (any codes we already use, with the issued tag always
   encoded last) feed `buildAttributionSuffix()`, which is appended via viem's
   `dataSuffix` on treasury payouts. x402 settlements cannot carry the suffix
   because the facilitator relayer broadcasts them; those are attributed by the
   registered agent wallet instead, which is why `X402_PAY_TO` must be the wallet
   declared at registration. `npm run x402:verify-attribution -- 0x<txHash>`
   decodes a transaction back off the chain, because a successful write is not
   proof that the suffix survived.
3. **Fee abstraction on the payout path.** `X402_FEE_CURRENCY=auto` resolves the
   documented Celo fee-currency adapter for the settlement asset (USDC
   `0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B`, USDT
   `0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72`, USAT
   `0x0357EE22278c922e1D36cFe6b899269b161880C4`), so treasury transactions pay
   gas in the same stablecoin as the payout.
4. **ERC-8004 identity.** `npm run x402:register-agent` registers the agent in
   the Celo Identity Registry with spec-shaped metadata (versioned `type` URI,
   `services`, `endpoint` per service, `supportedTrust`) encoded as a base64
   `data:` URI, and prints the `agentId`, a 8004scan URL, and the registration
   transaction. Registration needs `AGENT_NAME`, at least one of
   `AGENT_SERVICE_URL` / `AGENT_A2A_URL` / `AGENT_MCP_URL`, and
   `CELO_AGENT_REGISTRATION_PRIVATE_KEY` (or `X402_TREASURY_PRIVATE_KEY`).

The public repository ships no `.env` file, credential, user data or unrelated
product code; `.env.example` holds placeholders only.

## Sources

- https://celopedia.celo.org/
- https://x402.celo.org/SKILL.md
- https://api.x402.sepolia.celo.org/supported
- https://api.x402.celo.org/supported
- https://x402.celo.org/api/config
- `.agents/skills/celopedia-skill/references/contracts.md`
- `.agents/skills/celopedia-skill/references/ai-agents.md`

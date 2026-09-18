# Streamlivr: agents buy creator data on Celo

Streamlivr is a live-streaming and music app. Artists publish profiles, listings and a music catalog. This repository is the payment layer that sells that data to AI agents one HTTP request at a time over x402 on Celo, and then pays the artists whose data was served.

Four endpoints, priced at $0.005 or $0.01. Settlement happens in USDC, USDT or USAT through the hosted Celo facilitator. The buyer signs an EIP-3009 authorization, retries the request, and the facilitator pays the gas. Nobody needs CELO to buy anything.

Submitted to the Celo Agents at Work hackathon. Primary track: real-world adoption. Additional
track: Judges' Favorite.

```
agent  GET /api/v1/agent/catalog          402 Payment Required, price in the body
agent  signs a TransferWithAuthorization
agent  GET again with payment-signature    facilitator verifies and settles
                                           200 OK, the data, and payment-response with a tx hash
```

## Run it

You need Node 20 or newer, a facilitator key from https://x402.celo.org, and a Celo wallet address to receive the money.

```bash
cp .env.example .env
# set X402_API_KEY and X402_PAY_TO, leave X402_NETWORK=testnet for the first run
npm install
npm test          # 35 tests, no network access needed
npm run demo      # seller on http://127.0.0.1:3000
```

Ask for a paid route without paying and you get the x402 terms back:

```bash
curl -i http://127.0.0.1:3000/api/v1/agent/catalog
```

```http
HTTP/1.1 402 Payment Required

{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:11142220",
    "maxTimeoutSeconds": 60,
    "payTo": "0xYourCeloWallet",
    "price": {
      "amount": "10000",
      "asset": "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
      "extra": { "name": "USDC", "version": "2", "assetTransferMethod": "eip3009" }
    }
  }]
}
```

The `extra` block carries the EIP-712 domain the buyer has to sign over. Get `name` or `version` wrong and the facilitator rejects the payment, which is why those values live in `src/x402/config.ts` instead of being typed at the call site. USDC reports version `2`. USDT and USAT both report `1`, and USDT's `version()` call reverts, so the value comes from the facilitator's live config.

If you only want to check that the server boots, set `X402_ENABLED=false` and the routes answer `200` with `paid: false`.

## Routes and prices

Amounts are strings in token base units. Every asset here uses 6 decimals, so `10000` is one cent and `5000` is half a cent.

| Route | Price | Returns | Attribution |
|---|---:|---|---|
| `GET /api/v1/agent/ping` | `10000` | Liveness check that proves settlement works | none |
| `GET /api/v1/agent/listings` | `10000` | Public creator listings | each creator in the response |
| `GET /api/v1/agent/catalog` | `10000` | Catalog metadata, no media URLs | each creator behind the tracks |
| `GET /api/v1/agent/creator/:id` | `5000` | One public profile | that creator |
| `GET /healthz` | free | Process health | none |
| `GET /demo/settlements` | free | What this process settled, with the split | none |

Creator data is off by default. An endpoint only returns creators who turned on consent through an authenticated record, and the attribution rows are built from the rows the endpoint actually returned. A buyer cannot claim a creator they did not pay for.

## What a payment does

1. The seller answers without a payment header with `402` and the terms above.
2. The buyer signs an EIP-3009 `TransferWithAuthorization` off-chain. No approval transaction, no gas.
3. The buyer repeats the request with the `payment-signature` header.
4. The seller asks the Celo facilitator to verify, then to settle.
5. The stablecoin moves from the buyer to `X402_PAY_TO` inside the token contract. The facilitator never holds the funds.
6. The seller stores the settlement, splits it 60/40 between the creators returned by that endpoint and the platform, and responds with the `payment-response` header holding the transaction hash.

Repeat the same signed payload and you get the stored response and the original header, not a second charge. The authorization nonce is single-use, so a second settle would fail anyway.

## Where artists get paid

Artists hold a Celo wallet inside the Streamlivr app. It runs on Celo mainnet and Celo Sepolia, holds USDC, USDT and USDm, and supports sending, receiving and swapping. Signing goes through a Web3Auth-backed EVM provider, so the key material stays on the device and the app never asks the API to sign for it.

Payouts only go to an address the artist has proven they control. The API issues a nonce-bound message and the artist signs it with `personal_sign`; the API recovers the signer, checks it against the submitted address, and stores the checksummed result. One challenge, one use, ten minutes to expire. If an address is already linked to a different Streamlivr account the request fails with `409` rather than quietly moving someone else's payouts.

A creator can read their own numbers from `GET /api/v1/agent/earnings`: attributed, reserved, confirmed, outstanding, consent flags, and the last 100 payout rows. The arithmetic comes from the same module the admin payout run uses, so the number an artist sees is the number that gets paid.

## The admin system

The operator side runs on Streamlivr's admin dashboard. The Finance page has an x402 section built from the same design primitives as the rest of the console, and it shows settled volume, platform and creator shares, volume by endpoint, treasury receipts with transaction hashes, outbox health, live payouts and per-creator balances.

Each creator row also carries the eligibility state described below, who the status came from, and the wallet the payout would land in. A refresh button on that row pulls the current answer back from the ramp provider, and the batch floor is an input rather than a constant, so an operator can pay a small test balance without editing code.

Moving money never happens in one action. A payout starts as `PENDING` from a prepared batch, gets approved as a separate step, and only then can it be broadcast. Every step needs `SUPER_ADMIN` and writes an audit row; analysts get the read-only view, so the person watching the numbers isn't necessarily the person who can send funds.

```
PENDING -> APPROVED -> SUBMITTED -> CONFIRMED
                              \-> FAILED, which releases the balance for a later run
```

Three rules the payout path enforces:

- The transaction hash is stored before the receipt is awaited. A confirmation timeout leaves the row `SUBMITTED` with its hash, so a live transfer is never re-sent. `reconcile` reads the chain and decides.
- Execution re-checks the eligibility gate and the verified wallet. If the artist changed their payout address between approval and send, the payout stops instead of going to the old one.
- Treasury sends are serialized in process. Two in-flight transfers would fight over the same nonce. Running more than one API instance with payouts enabled needs a distributed lock, and the code says so in a comment rather than pretending otherwise.

### Who is allowed to be paid

Four conditions, all read from the creator's account at prepare time and again at send time:

| Gate | Source | Blocks when |
|---|---|---|
| Identity | `User.kycStatus` | anything other than `VERIFIED` |
| Fraud suspension | `User.isFraudSuspended` | `true` |
| Fraud score | `User.fraudRiskScore` | 80 or higher |
| Payout wallet | primary Celo wallet | missing |

`kycStatus` is not a field an operator edits. It holds the answer from the ramp provider, written by a signed webhook and refreshed by a five-minute reconcile worker. The payout path reads that stored answer rather than calling the provider inline, so a slow provider can't hold up a treasury transfer. `GET /admin/x402/creators` returns the four gates per creator plus the reason each one failed, and a prepare response lists every creator it skipped with the same detail.

Source of the status matters, and the code keeps the two apart. `kycStatus` on a creator with a provider customer is displayed as coming from the provider. A `VERIFIED` status with no provider customer can only have come from the local development switch, and it is labelled that way in the admin UI. That switch (`X402_LOCAL_KYC_OVERRIDE`) refuses to act whenever `NODE_ENV=production` or the provider environment is production, so an env file copied from a laptop into a deployment still can't hand out payout eligibility. `reference/local-kyc-override.ts` is the whole thing, guard included.

## Celo pieces in use

| Piece | Where it shows up |
|---|---|
| x402 v2 `exact` scheme with EIP-3009 | Every paid route, `src/x402/config.ts` |
| Hosted Celo facilitator, gas sponsored | `src/x402/facilitator.ts`, settlement in `demo/server.ts` |
| Fee abstraction | Payouts and agent registration can pay gas in the same stablecoin, via `X402_FEE_CURRENCY=auto` |
| ERC-8021 attribution | Appended to every transaction this code signs, verified by `npm run x402:verify-attribution` |
| ERC-8004 agent identity | `npm run x402:register-agent` registers the seller agent with spec-shaped metadata |

One thing worth spelling out: x402 settlements are broadcast by the facilitator's relayer, so the seller cannot attach an attribution suffix to them. Those are credited to the agent wallet registered with the programme instead. Transactions Streamlivr signs itself, such as creator payouts and the agent registration, carry the suffix in calldata. There is no way to add one afterwards.

## Assets

| Asset | Mainnet | Sepolia | Decimals | EIP-712 |
|---|---|---|---:|---|
| USDC | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` | `0x01C5C0122039549AD1493B8220cABEdD739BC44E` | 6 | `USDC` / `2` |
| USDT | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` | not settled | 6 | `Tether USD` / `1` |
| USAT | `0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771` | not settled | 6 | `Tether America USD` / `1` |

USDm and the other Mento stablecoins are not supported by this facilitator. They implement EIP-2612, and the hosted settlement engine expects EIP-3009. Configuring USDm would get you a working `402` and a payment that never settles, so the config rejects it.

Set `X402_SETTLEMENT_ASSET` to switch assets. `src/x402/config.ts` refuses to start when the network, asset, address or decimals disagree, which keeps a mainnet wallet from being paired with a Sepolia token.

## Verify the claims

```bash
npm run typecheck
npm test
npm run demo
npm run x402:buyer-smoke                                  # needs a funded buyer key
npm run x402:verify-attribution -- 0x<txHash>
```

The buyer canary wraps `fetch` with the x402 client, pins the asset and a per-payment cap, and fails unless the response carries a `payment-response` header with a real transaction hash. A `200` by itself does not pass.

For a full testnet pass: request a paid route and confirm the `402`, fund a throwaway buyer with Sepolia USDC from https://faucet.circle.com, run the canary, then look the hash up on https://celo-sepolia.blockscout.com and check that `GET /demo/settlements` recorded the same payment with a 60/40 split. The buyer needs no testnet CELO because gas is sponsored.

Real transactions from our runs go in [docs/ONCHAIN-PROOF.md](./docs/ONCHAIN-PROOF.md).

## Security

The facilitator key is attached to server-to-server calls and never reaches a client. No private key is read from a request body, a query string or a bundle; the buyer canary and the payout signer are server-side only. Receiving (`X402_PAY_TO`) and spending (`X402_TREASURY_PRIVATE_KEY`) are different wallets.

Amounts stay as integer strings in token base units from the moment a payment is read to the moment a payout is signed. Balances bigger than `Number.MAX_SAFE_INTEGER` don't lose a unit, and a failed transfer releases the reserved amount by construction rather than by a correction job.

## Scope

This repo holds the payment layer, the tests, three operator scripts and a runnable demo. The production API, the mobile app and the admin dashboard live in Streamlivr's private repositories. Three reference files reproduce the wiring that lives there: `reference/admin-payout-routes.ts` for prepare, approve, execute and reconcile, `reference/admin-revenue-routes.ts` for the reporting queries, and `reference/local-kyc-override.ts` for the development-only eligibility switch.

The creator side of the product does exist. Artists see and change their consent per data type, their attributed balance, their payout history and their linked Celo wallet in the app's wallet settings. That screen talks to the endpoints documented above and is not included here, because the app is private.

Not here yet: Self proof-of-personhood as an extra payout condition, and a scheduled job that compares stored settlement hashes against the receiving wallet's chain history. The second one is the next thing we'd build before any real volume.

## References

- x402 on Celo, agent-readable guide: https://x402.celo.org/SKILL.md
- Live facilitator config (assets, domains, treasury): https://x402.celo.org/api/config
- Celo docs: https://docs.celo.org
- ERC-8004 agent registries: https://eips.ethereum.org/EIPS/eip-8004 and https://8004scan.io
- ERC-8021 attribution tags: https://github.com/celo-org/attribution-tags
- EIP-3009: https://eips.ethereum.org/EIPS/eip-3009

MIT licensed. See [LICENSE](./LICENSE).

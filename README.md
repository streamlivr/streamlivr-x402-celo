# Streamlivr: agents buy creator data on Celo

Streamlivr is a live-streaming and music app. Artists publish profiles, listings and tracks. This
repository is the payment layer that sells that public data to software, one HTTP request at a time,
over x402 on Celo. Money that arrives gets attributed to the artists whose data was served, and
payouts leave from the Celo wallet the settlements landed in.

Four paid routes, priced at $0.005 or $0.01, settled in USDC through the hosted Celo facilitator. The
buyer signs an EIP-3009 authorization off-chain, retries the request, and the facilitator pays the
gas. A buyer never needs CELO.

The production service runs inside Streamlivr's private repositories. This repo carries the same
payment modules, a runnable reference server, and a browser demo site that pays real mainnet
invoices.

Submitted to the Celo Agents at Work hackathon. Primary track: real-world adoption. Additional
track: Judges' Favorite.

## Start here: the demo site

`demo/web` is a Next.js checkout that pays the live API from a burner wallet in your browser. One
click runs the whole loop: quote, signature, settlement, and a transaction link you can open on
Celo Blockscout. This is the fastest way to see the system work.

```bash
cd demo/web/web
cp .env.example .env.local
```

Set five values in `.env.local`:

```env
NEXT_PUBLIC_API_BASE_URL=https://api.streamlivr.com
NEXT_PUBLIC_BURNER_PRIVATE_KEY=0x...        # a throwaway key you fund
NEXT_PUBLIC_ENABLE_MAINNET=true             # false keeps the page on Celo Sepolia
NEXT_PUBLIC_MAX_ATOMIC_PER_REQUEST=10000    # $0.01, checked before anything is signed
NEXT_PUBLIC_MAX_ATOMIC_PER_SESSION=200000   # $0.20 for one browser session
```

```bash
npm install
npm run dev        # http://localhost:3008
```

The page opens on Celo mainnet. Pick a suggestion, or ask for creators or tracks. The chat first
probes the route and shows the invoice it got back, then signs the authorization in the background
and repeats the call with the payment header. Nothing pops up, because the burner key lives in the
bundle. The reply arrives with the settlement transaction hash, and `Payout ledger` in the header
shows the same payment split 60/40 between the creators and the platform.

**Funding the burner.** The key ships inside the browser bundle, so treat it as public and keep it
small. Send Celo mainnet USDC to the address printed at the top of `.env.local`; $0.05 covers a long
session at these prices. Do not send CELO, because the facilitator pays the transaction fee. The
per-request and per-session caps are the actual protection, and they are enforced before a signature
is created.

If a payment fails, it is almost always one of three things: the wallet is empty, the API base URL
points somewhere that does not serve these routes, or the API does not allow the page's origin
through CORS. The page shows the raw headers and the error from each step, so you can see which.

## The reference server

`demo/server.ts` is the same flow with an in-memory store instead of a database. Read it if you want
to see how the seller side is wired: route config, the facilitator client, settlement, replay
protection and the 60/40 split. It is deliberately small enough to read in one sitting.

```bash
cp .env.example .env
# set X402_API_KEY and X402_PAY_TO, leave X402_NETWORK=testnet for a first run
npm install
npm test           # 66 tests, no network access needed
npm run demo       # seller on http://127.0.0.1:3000
```

| Route | Price | Returns | Attribution |
|---|---:|---|---|
| `GET /api/v1/agent/ping` | `10000` | Liveness check that proves settlement works | none |
| `GET /api/v1/agent/listings` | `10000` | Public creator listings | each creator in the response |
| `GET /api/v1/agent/catalog` | `10000` | Catalog metadata, no media URLs | each creator behind the tracks |
| `GET /api/v1/agent/creator/:id` | `5000` | One public profile | that creator |
| `GET /.well-known/agent.json` | free | A2A agent card with prices and the ERC-8004 identity | none |
| `GET /.well-known/mcp.json` | free | MCP server card listing the same routes as tools | none |
| `POST /mcp` | paid per tool | MCP JSON-RPC, same prices as the HTTP routes | same as the route called |
| `GET /api/v1/agent/reputation` | free | On-chain ERC-8004 reputation plus settled volume | none |
| `GET /healthz` | free | Process health | none |
| `GET /demo/settlements` | free | What this process settled, with the split | none |
| `GET /api/v1/agent/demo/settlements` | free | The same ledger in the shape the demo site renders | none |
| `GET /api/v1/agent/demo/creators` | free | Per-creator balances for the demo site | none |

Amounts are strings in token base units. Every supported asset uses 6 decimals, so `10000` is one
cent.

Ask for a paid route without paying, and the terms come back in the `payment-required` header. In
x402 v2 the body is empty and the invoice is base64 encoded in that header:

```bash
curl -sD - -o /dev/null http://127.0.0.1:3000/api/v1/agent/catalog \
  | awk 'tolower($1) == "payment-required:" { print $2 }' \
  | base64 -d | jq
```

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://api.streamlivr.com/api/v1/agent/catalog",
    "serviceName": "streamlivr-catalog",
    "tags": ["x402", "celo", "music", "catalog"]
  },
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:42220",
    "maxTimeoutSeconds": 60,
    "payTo": "0xYourCeloWallet",
    "amount": "10000",
    "asset": "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    "extra": { "name": "USDC", "version": "2", "assetTransferMethod": "eip3009" }
  }]
}
```

The `extra` block is the EIP-712 domain the buyer signs over. Get `name` or `version` wrong and the
facilitator refuses the payment, which is why those values live in `src/x402/config.ts` instead of
being typed at the call site. USDC reports version `2`, USDT and USAT report `1`.

Set `X402_ENABLED=false` and the paid routes answer `200` with `paid: false`. The two well-known
discovery documents still resolve in that mode, with an empty route list and `paymentEnabled:
false`; `/mcp` and the reputation read return `404`, because neither can do anything useful without
settlement.

## What one payment does

1. An agent asks for a paid route with no payment and gets `402` plus the invoice in the
   `payment-required` header.
2. It signs an EIP-3009 `TransferWithAuthorization` off-chain. No approval transaction, no gas.
3. It repeats the request with the `payment-signature` header.
4. The seller asks the Celo facilitator to verify the signature, then to settle it.
5. USDC moves from the buyer to `X402_PAY_TO` inside the token contract. The facilitator never holds
   the funds.
6. The seller stores the settlement, splits 60% to the creators returned by that endpoint and 40%
   to the platform, and replies with the data plus a `payment-response` header holding the
   transaction hash.

Repeat the same signed payload and the stored response comes back instead of a second charge. The
authorization nonce is single-use, so a second settlement would fail anyway.

## Where artists get paid

Artists hold a Celo wallet inside the Streamlivr app, on mainnet and Sepolia, holding USDC, USDT and
USDm. Signing goes through a Web3Auth-backed provider, so key material stays on the device.

A payout only goes to an address the artist proved they control. The API issues a nonce-bound
message, the artist signs it, and the API recovers the signer and stores the checksummed result. One
challenge, one use, ten minutes to expire.

Money moves in three steps, never one. A batch is prepared as `PENDING`, approved as a separate act,
and only then broadcast. Every step needs `SUPER_ADMIN` and writes an audit row.

```
PENDING -> APPROVED -> SUBMITTED -> CONFIRMED
                              \-> FAILED, which releases the balance for a later run
```

Four gates decide who is payable, read at prepare time and again at send time:

| Gate | Source | Blocks when |
|---|---|---|
| Identity | `User.kycStatus` | anything other than `VERIFIED` |
| Fraud suspension | `User.isFraudSuspended` | `true` |
| Fraud score | `User.fraudRiskScore` | 80 or higher |
| Payout wallet | primary Celo wallet | missing |

`kycStatus` is not a field an operator edits. It holds the answer from the identity provider,
written by a signed webhook and refreshed by a reconcile worker. The payout path reads that stored
answer rather than calling the provider inline, so a slow provider cannot hold up a treasury
transfer.

Two rules keep the treasury honest. The transaction hash is stored before the receipt is awaited, so
a confirmation timeout leaves the row `SUBMITTED` for `reconcile` rather than re-sending live money.
Execution re-checks the wallet, so a creator who changes address between approval and send stops the
payout instead of redirecting it.

## Agent discovery and reputation

An agent that has never seen this project can go from a domain name to a paid call without a human
reading these docs.

`GET /.well-known/agent.json` is an A2A agent card. Skills map onto the paid routes and carry their
price in the tags. Payment detail sits in two declared capability extensions: one for x402 (scheme,
network, asset, receiving wallet, facilitator, price per route) and one for ERC-8004 pointing at the
registries, the agent id and the reputation endpoint.

`GET /.well-known/mcp.json` describes the MCP server: transport, protocol version, the payment
metadata key `x402/payment`, and one tool per route. `POST /mcp` is a stateless Streamable HTTP
handler that answers `initialize`, `tools/list`, `tools/call` and `ping`.

```bash
curl -s localhost:3000/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

`tools/list` returns only the fields the MCP spec defines, because strict clients reject unknown
keys. Call a tool with no payment and you get the x402 challenge back instead of an error. Pay it,
then repeat the call with the base64 payment payload under `params._meta["x402/payment"]`.

The MCP handler settles nothing itself. It forwards the call to the same HTTP route over loopback
with the caller's payment header attached, so verification, settlement, attribution and replay
protection all run through one path. There is no way to reach creator data through MCP without
paying.

The agent is registered on Celo mainnet as id `9852`. Its on-chain metadata lists seven services:
the web app, the A2A card, the MCP endpoint, and one entry per paid route. Route entries keep their
path parameters as `{id}` templates, since a concrete creator id would become a dead link the
moment that creator left the catalog.

Reputation works the way ERC-8004 intends. The registry refuses feedback from the agent's owner and
from any operator, so the wallet that paid is the only wallet that can rate:

```bash
npm run x402:give-feedback -- --tx 0x<settlement hash> --endpoint https://api.streamlivr.com/api/v1/agent/ping
```

The script builds a document holding the settlement hash, buyer, amount, asset and payee, hashes it
with `keccak256`, and passes it as a base64 `data:` URI next to that hash, so anyone can re-hash the
document and compare. Gas is paid in USDC through fee abstraction, which means a buyer with no CELO
can still leave a rating. `npm run x402:agent-status` reads the whole record back from the chain.

One contract detail is easy to misread. `getSummary` on this deployment returns an average, not a
sum. Two entries of `100` read back as count `2`, average `100`.

## On-chain proof

Every hash from our own runs is listed with its explorer link in
[docs/ONCHAIN-PROOF.md](./docs/ONCHAIN-PROOF.md): nine mainnet settlements, creator payouts, the
ERC-8004 registration and metadata update, two reputation entries, and the Sepolia history behind
them. Volume is small and the buyer is our own canary wallet. The page says so rather than dressing
it up.

## Verify it

```bash
npm run typecheck
npm test
npm run demo
npm run x402:buyer-smoke                                  # needs a funded buyer key
npm run x402:verify-attribution -- 0x<txHash>
npm run x402:agent-status
```

The buyer canary wraps `fetch` with the x402 client, pins the asset and a per-payment cap, and fails
unless the response carries a `payment-response` header with a real transaction hash. A `200` on its
own does not pass.

For a testnet pass: request a paid route and read the `402`, fund a throwaway buyer with Sepolia USDC
from https://faucet.circle.com, run the canary, then check the hash on
https://celo-sepolia.blockscout.com and confirm `GET /demo/settlements` recorded the same payment
with a 60/40 split. The buyer needs no testnet CELO, because gas is sponsored.

## Assets

| Asset | Mainnet | Sepolia | Decimals | EIP-712 |
|---|---|---|---:|---|
| USDC | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` | `0x01C5C0122039549AD1493B8220cABEdD739BC44E` | 6 | `USDC` / `2` |
| USDT | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` | not settled | 6 | `Tether USD` / `1` |
| USAT | `0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771` | not settled | 6 | `Tether America USD` / `1` |

USDm and the other Mento stablecoins are not supported by this facilitator. They implement EIP-2612,
and the hosted settlement engine expects EIP-3009, so a payment would return `402` and never settle.
The config rejects them at startup.

`src/x402/config.ts` refuses to boot when the network, asset, address or decimals disagree, which
keeps a mainnet wallet from being paired with a Sepolia token.

## Celo pieces in use

| Piece | Where it shows up |
|---|---|
| x402 v2 `exact` scheme with EIP-3009 | Every paid route, `src/x402/config.ts` |
| Hosted Celo facilitator, gas sponsored | `src/x402/facilitator.ts`, settlement in `demo/server.ts` |
| Fee abstraction | Payouts, agent registration and reputation writes pay gas in the settlement asset |
| ERC-8021 attribution | Appended to every transaction this code signs, checked by `npm run x402:verify-attribution` |
| ERC-8004 identity | Agent id `9852` on Celo mainnet, metadata built from the route catalog |
| ERC-8004 reputation | Buyer-signed feedback, read back by `npm run x402:agent-status` |

Settlements are broadcast by the facilitator's relayer, so the seller cannot attach an attribution
suffix to them. Those are credited to the agent wallet registered with the programme instead.
Transactions Streamlivr signs itself, such as payouts and the agent registration, carry the suffix
in calldata. There is no way to add one afterwards.

## Scope

This repo holds the payment modules, their tests, five operator scripts, a runnable reference server
and the demo site. The production API, the mobile app and the admin console live in Streamlivr's
private repositories. Three reference files reproduce the wiring that lives there:
`reference/admin-payout-routes.ts` for prepare, approve, execute and reconcile,
`reference/admin-revenue-routes.ts` for the reporting queries, and
`reference/local-kyc-override.ts` for the development-only eligibility switch.

What is not here yet: a scheduled job that compares stored settlement hashes against the receiving
wallet's chain history, payout signing behind a KMS or hardware signer, and a distributed lock so
more than one API instance can send payouts safely. Those are the next three things we would build
before real volume. Today the treasury sends are serialized in process, and the code says so in a
comment rather than pretending otherwise.

## Security

The facilitator key is attached to server-to-server calls and never reaches a client. No private key
is read from a request body, a query string or a bundle. The buyer canary and the payout signer are
server-side only.

Amounts stay as integer strings in token base units from the moment a payment is read to the moment
a payout is signed. Balances larger than `Number.MAX_SAFE_INTEGER` do not lose a unit, and a failed
transfer releases the reserved amount by construction rather than by a correction job.

`npm audit` reports five advisories, all in the test toolchain (`vitest`, `vite`, `esbuild`).
`npm audit --omit=dev` is clean, so nothing that runs in production is affected. Clearing them means
a major `vitest` upgrade, which is queued rather than rushed in the week of a submission.

## References

- x402 on Celo, agent-readable guide: https://x402.celo.org/SKILL.md
- Live facilitator config: https://x402.celo.org/api/config
- Celo docs: https://docs.celo.org
- ERC-8004 agent registries: https://eips.ethereum.org/EIPS/eip-8004 and https://8004scan.io/agents/celo/9852
- ERC-8021 attribution tags: https://github.com/celo-org/attribution-tags
- EIP-3009: https://eips.ethereum.org/EIPS/eip-3009

MIT licensed. See [LICENSE](./LICENSE).

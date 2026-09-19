# On-chain proof

Every hash on this page is a real transaction. Open the explorer link and the transfer is there.
Nothing below is a simulated result, and rows that were cancelled say so.

## Environment

| Field | Value |
|---|---|
| Network | Celo mainnet, chain `42220` |
| Settlement asset | USDC `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` |
| Receiving wallet | `0x4503F32dFF9e54Ee4c0Fd9BE25bCC662abB4c4Bf` |
| Payout wallet | same address, one wallet by design (see the note below) |
| Buyer canary wallet | `0xf5Fe75828381b7E4881E8a5aB4575868A801038c` |
| ERC-8021 attribution tag | `celo_afe6af2bc55d` |
| ERC-8004 agent | id `9852` on the Identity Registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ERC-8004 reputation | Reputation Registry `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |

The receiving wallet and the payout wallet are the same address. Settlement lands there, payouts are
signed from there, and there is no sweep step to forget. Before that, the two were separate and the
payouts failed with `transfer amount exceeds balance`, because the USDC was sitting one address away
from the key that needed it. The one-wallet layout was the fix.

## Settlements (buyer to Streamlivr)

Nine settlements on Celo mainnet, all on 18 September 2026. Each one came from
`npm run x402:buyer-smoke`, which refuses to print a result unless the response carries a
`payment-response` header with a transaction hash. A `200` on its own would not pass.

| # | Endpoint | Amount (atomic) | Tx hash | Explorer |
|---|---|---|---|---|
| 1 | `/api/v1/agent/ping` | `10000` | `0xdd594c9f28e512d5d76579f451da75d6626c63fb2bb41e843fbf5f18fb47e15b` | [link](https://celo.blockscout.com/tx/0xdd594c9f28e512d5d76579f451da75d6626c63fb2bb41e843fbf5f18fb47e15b) |
| 2 | `/api/v1/agent/listings` | `10000` | `0xa207390be01a2bc310825e8d8b1f1bc35e20dd32efc2315266a2d6acf650a5ff` | [link](https://celo.blockscout.com/tx/0xa207390be01a2bc310825e8d8b1f1bc35e20dd32efc2315266a2d6acf650a5ff) |
| 3 | `/api/v1/agent/catalog` | `10000` | `0x37e0f22a9fde2689b639e78d3c4cd6d7c20125562add6da2e1e798f8d784d575` | [link](https://celo.blockscout.com/tx/0x37e0f22a9fde2689b639e78d3c4cd6d7c20125562add6da2e1e798f8d784d575) |
| 4 | `/api/v1/agent/creator/b086b910` | `5000` | `0xac33ea3354341680746b5e8ee3438a6b2fb5884bb09bac4416fd7a7c9d0dc820` | [link](https://celo.blockscout.com/tx/0xac33ea3354341680746b5e8ee3438a6b2fb5884bb09bac4416fd7a7c9d0dc820) |
| 5 | `/api/v1/agent/catalog` | `10000` | `0x8beb38b61727a9a4375627d250a0bb16cbb36bc54cae82ebff5d0ed09ea2902f` | [link](https://celo.blockscout.com/tx/0x8beb38b61727a9a4375627d250a0bb16cbb36bc54cae82ebff5d0ed09ea2902f) |
| 6 | `/api/v1/agent/creator/b086b910` | `5000` | `0xb2efb54c16ef46c6a72716130831d40be35850312dcadf8dd84500d1df77031a` | [link](https://celo.blockscout.com/tx/0xb2efb54c16ef46c6a72716130831d40be35850312dcadf8dd84500d1df77031a) |
| 7 | `/api/v1/agent/listings` | `10000` | `0xbab08536ad0373767646fd009241afb4bf788425f67daec34f62600bf86ecd48` | [link](https://celo.blockscout.com/tx/0xbab08536ad0373767646fd009241afb4bf788425f67daec34f62600bf86ecd48) |
| 8 | `/api/v1/agent/ping` | `10000` | `0x266de117e020c57a13c415326510def42164d2f9958aa29d932bb9be73eb6d6c` | [link](https://celo.blockscout.com/tx/0x266de117e020c57a13c415326510def42164d2f9958aa29d932bb9be73eb6d6c) |
| 9 | `/api/v1/agent/creator/cmmggbkik` | `5000` | `0x8f67029d36fdf63eebca49824e44827c939c0618ece2e4864e7276e737d1011f` | [link](https://celo.blockscout.com/tx/0x8f67029d36fdf63eebca49824e44827c939c0618ece2e4864e7276e737d1011f) |

Total settled: `75000` atomic units, which is `0.075` USDC. One buyer wallet, nine requests, every
route on this repository paid at least once.

Settlements 1 to 7 were the first mainnet run, right after the network switch. Rows 8 and 9 were
repeated after the discovery extension and the reputation feedback shipped, to prove those changes
did not disturb the payment path.

### Sepolia run, kept for history

The first end-to-end runs happened on Celo Sepolia before the mainnet switch. Same code, same route
prices. Eleven settlements ran there in all, `105000` atomic units. The first five, in order, are
below; the rest repeated the same routes while the canary and the payout path were being wired up.

| # | Endpoint | Amount | Tx hash | Explorer |
|---|---|---|---|---|
| 1 | `/api/v1/agent/ping` | `10000` | `0x3ad114ff21bd5211fdb79ff223244bf42be81ae29ac6d7fa1790bb9d76232adb` | [link](https://celo-sepolia.blockscout.com/tx/0x3ad114ff21bd5211fdb79ff223244bf42be81ae29ac6d7fa1790bb9d76232adb) |
| 2 | `/api/v1/agent/listings` | `10000` | `0x0264c2944d5f1df19e88a18210fe45cd0157482dca524f543ebe5c8e85c0b9c8` | [link](https://celo-sepolia.blockscout.com/tx/0x0264c2944d5f1df19e88a18210fe45cd0157482dca524f543ebe5c8e85c0b9c8) |
| 3 | `/api/v1/agent/listings` | `10000` | `0x886670f7a869cd5bc02d4ffa3f756cfec374e8c7fddde22664628256353be463` | [link](https://celo-sepolia.blockscout.com/tx/0x886670f7a869cd5bc02d4ffa3f756cfec374e8c7fddde22664628256353be463) |
| 4 | `/api/v1/agent/catalog` | `10000` | `0x0983e6a2e1133891f14756ffe9b2613eb0e0965306108a62b6147637e3271e89` | [link](https://celo-sepolia.blockscout.com/tx/0x0983e6a2e1133891f14756ffe9b2613eb0e0965306108a62b6147637e3271e89) |
| 5 | `/api/v1/agent/creator/<id>` | `5000` | `0x5794d45592adfb55cdd55fd4af1c3c314c48356062ebdee155eb504720476b2a` | [link](https://celo-sepolia.blockscout.com/tx/0x5794d45592adfb55cdd55fd4af1c3c314c48356062ebdee155eb504720476b2a) |

## Creator payouts (Streamlivr to creator)

Two mainnet payouts landed, both smaller than the minimum a human would normally approve, because
the point was to exercise the path rather than to move a meaningful amount. The amounts are the
creator share of settled volume, not the gross payment.

| # | Creator | Attributed | Paid (atomic) | Network | Tx hash | Explorer |
|---|---|---|---|---|---|---|
| 1 | `grant` | from catalog and listings sales | `20000` | Celo mainnet | `0x085776bfd007c08175ab7c805d29c7f23fc88827c784233fd9e254ec9100d6fe` | [link](https://celo.blockscout.com/tx/0x085776bfd007c08175ab7c805d29c7f23fc88827c784233fd9e254ec9100d6fe) |
| 2 | `lilgranted` | from catalog sales | `12000` | Celo mainnet | `0x5fc3892e52f2dd0c55449f7d7c5f2fb439d237bf60e24195ac417b78dc12e2ea` | [link](https://celo.blockscout.com/tx/0x5fc3892e52f2dd0c55449f7d7c5f2fb439d237bf60e24195ac417b78dc12e2ea) |

### Sepolia payouts, kept for history

Two payouts ran on Celo Sepolia before the mainnet switch. Both are still in the database.

| # | Creator | Paid (atomic) | Network | Tx hash | Explorer |
|---|---|---|---|---|---|
| 1 | `guest_II0lhw` | `2000` | Celo Sepolia | `0xda624627fbf575264e3d7845d0aeaac13d52ba72ea66fd9d3140d695ec2e47b2` | [link](https://celo-sepolia.blockscout.com/tx/0xda624627fbf575264e3d7845d0aeaac13d52ba72ea66fd9d3140d695ec2e47b2) |
| 2 | `lilgranted` | `2000` | Celo Sepolia | `0x918d25abb79a3e4319547169607a18010e6ee03a586b2c8a0ad00eee9ec12609` | [link](https://celo-sepolia.blockscout.com/tx/0x918d25abb79a3e4319547169607a18010e6ee03a586b2c8a0ad00eee9ec12609) |

A third mainnet row for `guest_II0lhw` (`6000` atomic) was cancelled from the admin dashboard and
never signed. It stays visible in the payout table as `CANCELLED` with no transaction hash, which is
what the code is supposed to do: a cancelled payout keeps its audit trail instead of disappearing.

## Agent identity and discovery

Registered on Celo mainnet with the metadata document this repository serves at
`/.well-known/agent.json`.

| Action | Transaction | Explorer |
|---|---|---|
| `register()` on the Identity Registry | `0x284db57aeb94b4eb60e950a2359d6480355ab29597de3a663879e7aac240debf` | [link](https://celo.blockscout.com/tx/0x284db57aeb94b4eb60e950a2359d6480355ab29597de3a663879e7aac240debf) |
| `setAgentURI()` with the discovery services array | `0x9838bc18e52475029eae942f8222088e0391ff385122917134486f7e4c5e2e40` | [link](https://celo.blockscout.com/tx/0x9838bc18e52475029eae942f8222088e0391ff385122917134486f7e4c5e2e40) |

Both transactions carry the `celo_afe6af2bc55d` ERC-8021 attribution suffix. The registry address is
`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` and the agent id is `9852`. Read it back with:

```
npm run x402:agent-status
```

The metadata lists seven services: the web app, the A2A card, the MCP endpoint, and one entry per
paid route. Discovery documents are content addressed as a base64 `data:` URI on-chain, so the
record cannot be edited after the fact.

## Reputation

Two feedback entries, both signed by the buyer wallet rather than by the agent. The registry rejects
self-feedback from the owner, which is the whole point: a rating only counts when a counterparty
leaves it.

| # | Tag | Value | Buyer | Tx hash | Explorer |
|---|---|---|---|---|---|
| 1 | `successRate` / `x402` | `100` (0 decimals) | `0xf5Fe7582…1038c` | `0xd7af6d53c78bdef228eeccae956ebcfe04b9622572d7d027e23b0767dfe21d3b` | [link](https://celo.blockscout.com/tx/0xd7af6d53c78bdef228eeccae956ebcfe04b9622572d7d027e23b0767dfe21d3b) |
| 2 | `successRate` / `x402` | `100` (0 decimals) | `0xf5Fe7582…1038c` | `0x5aed1d6727352099569db594cddb39d98888cbf9749611faa869b038bc8c2aaf` | [link](https://celo.blockscout.com/tx/0x5aed1d6727352099569db594cddb39d98888cbf9749611faa869b038bc8c2aaf) |

The registry returns an average, not a sum. Two entries of `100` read back as count `2`, average
`100`. Read the live values from the API:

```
curl https://api.streamlivr.com/api/v1/agent/reputation
```

Each feedback document embeds the settlement transaction it refers to, so a reader can check the
rating against the payment that earned it.

## Operational transactions

Not product features, listed so the balances make sense.

| What | Amount | Transaction | Explorer |
|---|---|---|---|
| Funding the agent wallet before registration | `4` CELO | `0x10b4d46549fa1c4bf69b79906a13116a1bf3e2304a74f98d04b6ebdfa68adee7` | [link](https://celo.blockscout.com/tx/0x10b4d46549fa1c4bf69b79906a13116a1bf3e2304a74f98d04b6ebdfa68adee7) |
| Sending the buyer enough CELO for one feedback transaction, before the USDC fee path was wired | `0.05` CELO | `0x47c4ccf8a9e6a021cd14f6011cfa57a640bfc7128c0e45eeac8b45ed80cde14c` | [link](https://celo.blockscout.com/tx/0x47c4ccf8a9e6a021cd14f6011cfa57a640bfc7128c0e45eeac8b45ed80cde14c) |

The buyer canary pays gas in USDC through Celo fee abstraction, so it does not need CELO. That
second transfer is what the failed attempt looked like before fee abstraction was wired: the
feedback call reverted with `insufficient funds for gas * price + value`, and paying the fee in USDC
fixed it. Set `X402_BUYER_FEE_CURRENCY=none` to spend CELO instead.

## What the code checks before it claims a settlement

`npm run x402:buyer-smoke` fails loudly on a missing `payment-response` header, a settlement object
that says `success: false`, or a transaction hash that is not 32 bytes of hex. Every settlement row
above came from that script, and the payout rows came from the admin dashboard, which records the
hash before it waits for a receipt so a timeout can never make a sent transfer look unsent.

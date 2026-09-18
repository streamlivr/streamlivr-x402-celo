# On-chain proof

Every hash below is a real transaction on a Celo network. Follow the explorer link and the transfer
is there. Rows that still hold placeholders have not been run yet, and they say so.

## Environment

| Field | Value |
|---|---|
| Network | Celo Sepolia, chain `11142220` |
| Settlement asset | USDC `0x01C5C0122039549AD1493B8220cABEdD739BC44E` |
| Receiving wallet, current | `0xd460Cdc2CBeF980abaE944C9aB438e0f069671F2` |
| Receiving wallet, earlier run | `0x20426469Aec143f5AF26e0d442cA678b716AC4D5` |
| Treasury wallet (payouts) | `0x7a907D4669972fDB0230e3ED7Bc80a48Cc48DB34` |
| Buyer wallet (canary) | `0xf5Fe75828381b7E4881E8a5aB4575868A801038c` |
| ERC-8021 attribution tag | not issued yet, registration pending |
| ERC-8004 agent ID | not registered yet, mainnet step |

The receiving wallet changed once, after the first three settlements. That is why the table names the
destination per row rather than assuming one address held all of them.

## Settlements (buyer to Streamlivr)

All 18 September 2026. Each row came from `npm run x402:buyer-smoke`, which fails unless the response
carries a `payment-response` header with a transaction hash, so nothing here is a `200` that merely
looked right.

| # | Endpoint | Amount | Buyer | Tx hash | Explorer |
|---|---|---|---|---|---|
| 1 | `/api/v1/agent/ping` | `10000` | `0xf5Fe7582…1038c` | `0x3ad114ff21bd5211fdb79ff223244bf42be81ae29ac6d7fa1790bb9d76232adb` | [link](https://celo-sepolia.blockscout.com/tx/0x3ad114ff21bd5211fdb79ff223244bf42be81ae29ac6d7fa1790bb9d76232adb) |
| 2 | `/api/v1/agent/listings` | `10000` | `0xf5Fe7582…1038c` | `0x0264c2944d5f1df19e88a18210fe45cd0157482dca524f543ebe5c8e85c0b9c8` | [link](https://celo-sepolia.blockscout.com/tx/0x0264c2944d5f1df19e88a18210fe45cd0157482dca524f543ebe5c8e85c0b9c8) |
| 3 | `/api/v1/agent/listings` | `10000` | `0xf5Fe7582…1038c` | `0x886670f7a869cd5bc02d4ffa3f756cfec374e8c7fddde22664628256353be463` | [link](https://celo-sepolia.blockscout.com/tx/0x886670f7a869cd5bc02d4ffa3f756cfec374e8c7fddde22664628256353be463) |
| 4 | `/api/v1/agent/listings` | `10000` | `0xf5Fe7582…1038c` | `0xc7d9fd8212f7f75c0aa33088af3d1c992c7766eb86a6ebc02f6a504421bbd196` | [link](https://celo-sepolia.blockscout.com/tx/0xc7d9fd8212f7f75c0aa33088af3d1c992c7766eb86a6ebc02f6a504421bbd196) |
| 5 | `/api/v1/agent/listings` | `10000` | `0xf5Fe7582…1038c` | `0x9c1d154270ca8d279094487ddcdd8607b52f28a9455807347d9d522d80becefc` | [link](https://celo-sepolia.blockscout.com/tx/0x9c1d154270ca8d279094487ddcdd8607b52f28a9455807347d9d522d80becefc) |
| 6 | `/api/v1/agent/ping` | `10000` | `0xf5Fe7582…1038c` | `0x0db19c32a7e6b872bb3dab8a50b7ff768e4c9dcd7e0d7155be2220a4538e4ba1` | [link](https://celo-sepolia.blockscout.com/tx/0x0db19c32a7e6b872bb3dab8a50b7ff768e4c9dcd7e0d7155be2220a4538e4ba1) |
| 7 | `/api/v1/agent/catalog` | `10000` | `0xf5Fe7582…1038c` | `0x0983e6a2e1133891f14756ffe9b2613eb0e0965306108a62b6147637e3271e89` | [link](https://celo-sepolia.blockscout.com/tx/0x0983e6a2e1133891f14756ffe9b2613eb0e0965306108a62b6147637e3271e89) |
| 8 | `/api/v1/agent/catalog` | `10000` | `0xf5Fe7582…1038c` | `0x15c442c630cc0facee4e8a2f72abc65e69bd0c868ef0fc258c52a75958e6d138` | [link](https://celo-sepolia.blockscout.com/tx/0x15c442c630cc0facee4e8a2f72abc65e69bd0c868ef0fc258c52a75958e6d138) |
| 9 | `/api/v1/agent/creator/<id>` | `5000` | `0xf5Fe7582…1038c` | `0x5794d45592adfb55cdd55fd4af1c3c314c48356062ebdee155eb504720476b2a` | [link](https://celo-sepolia.blockscout.com/tx/0x5794d45592adfb55cdd55fd4af1c3c314c48356062ebdee155eb504720476b2a) |

Rows 1 to 3 settled to `0x20426469…AC4D5`; rows 4 to 9 settled to `0xd460Cdc2…671F2`.

The `payment-response` header of a successful paid request, abridged:

```json
{ "success": true, "transaction": "0xc7d9fd82…bd196", "network": "eip155:11142220" }
```

## Creator payouts (Streamlivr to creator)

No payout row is listed yet. The treasury is funded on Sepolia, both creator wallets are linked, and
the first payout run is the next thing on the list. Rows get added here with the hash once the
transfer lands, including the creator share rather than the gross payment.

| # | Creator | Attributed | Paid | Tx hash | Explorer |
|---|---|---|---|---|---|
| 1 | pending | | | | |

## Attribution verification

Run against a payout transaction or the agent registration, which are the transactions this codebase
signs itself. A facilitator-broadcast settlement carries no suffix, and the verifier says so instead
of pretending otherwise.

```bash
npm run x402:verify-attribution -- <payout tx hash>
```

```json
{ "ok": true, "codes": ["<celo_...>"], "schemaId": 0, "assignedTagPresent": true }
```

## Agent identity transaction

Registration runs on Celo mainnet, so this table stays empty until the mainnet pass.

| Field | Value |
|---|---|
| Registration tx | pending |
| Agent ID | pending |
| Agent URL | pending |
| Metadata URI | pending |

## Notes

- Sepolia activity proves the mechanics. Mainnet activity is what a value-based track counts, and
  those rows get added with the same format.
- Replaying a signed payload returns the stored response and the original hash rather than settling
  twice. When that happens during a run it gets written here, because the missing second transfer is
  the proof.
- The facilitator key has a credit balance. A failed request during a run is worth a look at that
  balance before blaming the code.

# Submission notes

Submitted to the Celo Agents at Work hackathon. The primary track is real-world adoption, with Judges' Favorite entered as the additional track. 

## What this submission demonstrates

Agents can buy creator data per request on Celo mainnet, in a stablecoin, without holding CELO. The money that comes in gets attributed to the artists whose data was served, and a creator payout moves it out again from a separate treasury wallet.

The Celo pieces the Judges' Favorite track text names are load-bearing here rather than decorative:

| Primitive | Where it runs |
|---|---|
| Fee abstraction | Creator payouts and agent registration pay gas in the settlement asset (`X402_FEE_CURRENCY=auto`) |
| ERC-8021 attribution | Appended to every transaction this code signs, with a verifier in `src/scripts/celo-verify-attribution.ts` |
| ERC-8004 identity | The seller agent registers on-chain with spec-shaped metadata (`src/scripts/celo-register-agent.ts`) |

There's a fourth: EIP-3009 settlement through the hosted Celo facilitator, which is what makes a half-cent HTTP request worth selling.

Payout eligibility is the part that keeps this honest as a payments system rather than a demo. A
creator is paid only when the identity check from the ramp provider says verified, the fraud flags
are clear, and a wallet they proved they control is on file. That gate is re-read at send time, not
only when the batch is prepared, and a creator who fails it is named in the batch response with the
reason.

## Distribution

Streamlivr is a live product. The mobile app carries the Celo wallet artists get paid into, and the admin dashboard is where payouts get approved and sent. The payment layer in this repository is what connects the two when an agent, not a person, is the one paying.

## Verify it

```
npm run typecheck
npm test
npm run demo
npm run x402:buyer-smoke
npm run x402:verify-attribution -- 0x<txHash>
```

Transactions from our own runs are listed in [ONCHAIN-PROOF.md](./ONCHAIN-PROOF.md).

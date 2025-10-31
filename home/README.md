# Encrypted mUSDT Staking Frontend

This Vite + React application powers the confidential staking experience. It relies on wagmi, RainbowKit, viem, and the
Zama relayer SDK to fetch encrypted contract state, decrypt balances locally, encrypt staking inputs, and submit
transactions with ethers.

## Key Features

- Claim the initial encrypted mUSDT balance once per address
- Stake and unstake mUSDT with ciphertexts produced through the relayer SDK
- Claim 1% daily interest, computed on-chain and surfaced only to the user
- Real-time decryption of liquid, staked, and pending reward balances via user-decrypt

## Getting Started

```bash
npm install
npm run dev
```

Update `src/config/contracts.ts` with the deployed `EncryptedStaking` address before running against Sepolia. Reads use
`viem` while writes use ethers as required.

# aave-withdrawer

Node.js scripts for:

- encrypting an Ethereum private key to a local JSON file
- calling Aave v3 `Pool.withdraw(address,uint256,address)` on Ethereum mainnet

Defaults:

- Pool: `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`
- Asset: `0xdAC17F958D2ee523a2206206994597C13D831ec7` (USDT)
- Retry delay: `10` seconds

## Install

```bash
npm install
```

## Encrypt a private key

```bash
Encrypts and saves private key to private-key.enc.json
npm run encrypt-key
```

The script prompts for:

- private key
- passphrase used to encrypt private key

## Withdraw

```bash
# Withdraw 1000 USDT. Runs once
npm run withdraw -- 1000 --once
```

```bash
# Withdraw 1000 USDT. Runs forever. Retries every 60 seconds
npm run withdraw -- 1000 --sleep-seconds 60
```

The withdraw destination is the address derived from the decrypted private key.

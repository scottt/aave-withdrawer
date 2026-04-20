#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { encryptPrivateKey } from "../src/crypto.js";
import { prompt } from "../src/prompt.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const { values } = parseArgs({
    options: {
      out: {
        type: "string",
        default: "./private-key.enc.json"
      }
    }
  });

  const privateKeyInput = (await prompt("Private key: ", { silent: true })).trim();
  const normalizedPrivateKey = privateKeyInput.startsWith("0x")
    ? privateKeyInput
    : `0x${privateKeyInput}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalizedPrivateKey)) {
    throw new Error("Private key must be 64 hex characters, with or without a 0x prefix.");
  }

  const passphrase = await prompt("Encryption passphrase: ", { silent: true });
  const confirmPassphrase = await prompt("Confirm passphrase: ", { silent: true });
  if (!passphrase) {
    throw new Error("Passphrase cannot be empty.");
  }
  if (passphrase !== confirmPassphrase) {
    throw new Error("Passphrases do not match.");
  }

  const payload = encryptPrivateKey(normalizedPrivateKey, passphrase);
  const outputPath = path.resolve(__dirname, "..", values.out);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), { mode: 0o600 });

  console.log(`Encrypted key written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { decryptPrivateKey } from "../src/crypto.js";
import { logger } from "../src/logger.js";
import { prompt } from "../src/prompt.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_RPC_URL = "https://ethereum-rpc.publicnode.com";
const DEFAULT_POOL_ADDRESS = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
const DEFAULT_USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const DEFAULT_KEY_FILE = "./private-key.enc.json";
const DEFAULT_SLEEP_SECONDS = 10;
const USDT_DECIMALS = 6;
const MIN_RETRY_AMOUNT = 1000n

const POOL_ABI = [
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
  "error Error(string)",
  "error Panic(uint256)",
  "error InvalidAmount()",
  "error ReserveInactive()",
  "error ReservePaused()",
  "error ReserveFrozen()",
  "error HealthFactorLowerThanLiquidationThreshold()",
  "error NotEnoughAvailableUserBalance()",
  "error WithdrawToAToken()"
];
const POOL_INTERFACE = new ethers.Interface(POOL_ABI);

function printUsage() {
  logger.error("Usage: node scripts/withdraw-usdt.js <amount>");
  logger.error("");
  logger.error("Positional arguments:");
  logger.error("  amount                  USDT amount in display units, e.g. 1234.012345");
  logger.error("");
  logger.error("Options:");
  logger.error(`  --sleep-seconds <n>     Retry delay in seconds (default: ${DEFAULT_SLEEP_SECONDS})`);
  logger.error(`  --key-file <path>       Encrypted private key file (default: ${DEFAULT_KEY_FILE})`);
  logger.error(`  --rpc-url <url>         Ethereum RPC URL (default: ${DEFAULT_RPC_URL})`);
  logger.error(`  --pool <address>        Pool address (default: ${DEFAULT_POOL_ADDRESS})`);
  logger.error(`  --asset <address>       Asset address (default: ${DEFAULT_USDT_ADDRESS})`);
  logger.error("  --once                  Run a single attempt and exit on failure");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDecodedArg(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => formatDecodedArg(item));
  }

  return value;
}

function findRevertData(value, seen = new Set()) {
  if (typeof value === "string") {
    return ethers.isHexString(value) && value.length >= 10 ? value : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  if (seen.has(value)) {
    return null;
  }
  seen.add(value);

  for (const key of ["data", "error", "info", "revert", "result"]) {
    const revertData = findRevertData(value[key], seen);
    if (revertData) {
      return revertData;
    }
  }

  for (const nestedValue of Object.values(value)) {
    const revertData = findRevertData(nestedValue, seen);
    if (revertData) {
      return revertData;
    }
  }

  return null;
}

function decodeRevertData(error) {
  const data = findRevertData(error);
  if (!data) {
    return null;
  }

  try {
    const decoded = POOL_INTERFACE.parseError(data);
    return {
      selector: data.slice(0, 10),
      name: decoded?.name ?? null,
      signature: decoded?.signature ?? null,
      args: decoded ? Array.from(decoded.args, (arg) => formatDecodedArg(arg)) : []
    };
  } catch {
    return {
      selector: data.slice(0, 10),
      name: null,
      signature: null,
      args: [],
      rawData: data
    };
  }
}

async function loadWallet(keyFile, provider) {
  const payload = JSON.parse(fs.readFileSync(keyFile, "utf8"));
  const passphrase = await prompt("Passphrase to decrypt private key: ", { silent: true });
  const privateKey = decryptPrivateKey(payload, passphrase).trim();
  return new ethers.Wallet(privateKey, provider);
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      "sleep-seconds": {
        type: "string",
        default: String(DEFAULT_SLEEP_SECONDS)
      },
      "key-file": {
        type: "string",
        default: DEFAULT_KEY_FILE
      },
      "rpc-url": {
        type: "string",
        default: process.env.ETH_RPC_URL || DEFAULT_RPC_URL
      },
      pool: {
        type: "string",
        default: DEFAULT_POOL_ADDRESS
      },
      asset: {
        type: "string",
        default: DEFAULT_USDT_ADDRESS
      },
      once: {
        type: "boolean",
        default: false
      }
    },
    allowPositionals: true
  });

  const amountInput = positionals[0];
  if (!amountInput) {
    printUsage();
    process.exit(1);
  }

  const sleepSeconds = Number(values["sleep-seconds"]);
  if (!Number.isFinite(sleepSeconds) || sleepSeconds <= 0) {
    throw new Error("--sleep-seconds must be a positive number.");
  }

  const keyFile = path.resolve(__dirname, "..", values["key-file"]);
  if (!fs.existsSync(keyFile)) {
    throw new Error(`Encrypted key file not found: ${keyFile}`);
  }

  const provider = new ethers.JsonRpcProvider(values["rpc-url"]);
  const wallet = await loadWallet(keyFile, provider);
  const to = await wallet.getAddress();
  const pool = new ethers.Contract(values.pool, POOL_ABI, wallet);
  const originalAmount = ethers.parseUnits(amountInput, 1);
  let amount = originalAmount;
  const sleepMs = Math.round(sleepSeconds * 1000);

  logger.info(`Sender: ${to}`);
  logger.info(`Pool: ${values.pool}`);
  logger.info(`Asset: ${values.asset}`);
  logger.info(values.once ? "Mode: single attempt" : `Retry delay: ${sleepSeconds} second(s)`);

  let attempt = 0;
  for (;;) {
    attempt += 1;
    for (amount = originalAmount; amount >= MIN_RETRY_AMOUNT; amount /= 10n) {
      logger.info(
        `Attempt ${attempt}: sending Pool.withdraw(...) for ${amount} USDT`
      );

      try {
        const amountOnChain = ethers.parseUnits(amount.toString(), USDT_DECIMALS)
        const tx = await pool.withdraw(values.asset, amountOnChain, to);
        logger.info(`Transaction submitted: ${tx.hash}`);

        const receipt = await tx.wait();
        logger.info(`Transaction confirmed in block ${receipt.blockNumber}`);
        if (values.once) {
          return;
        }
        break;
      } catch (error) {
        const reason = error?.shortMessage || error?.reason || error?.message || String(error);
        const decodedRevert = decodeRevertData(error);

        logger.error(`Attempt ${attempt} amount: ${amount} failed: ${reason}`);
        if (decodedRevert) {
          logger.error(`Decoded revert data:\n${JSON.stringify(decodedRevert, null, 2)}`);
        }
        logger.error(`Raw error:\n${JSON.stringify(error, null, 2)}\n`);
        logger.error(
          `estimateGas failed; reducing amount by 10x for the next attempt`
        );
        if (values.once) {
          process.exitCode = 1;
          return;
        }
      }
    }
    logger.error(`Amount < ${MIN_RETRY_AMOUNT}. Sleeping for ${sleepSeconds} second(s) before retrying...`);
    await sleep(sleepMs);
  }
}

main().catch((error) => {
  logger.error(error.message);
  process.exitCode = 1;
});

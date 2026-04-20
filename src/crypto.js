import crypto from "node:crypto";

const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

function deriveKey(passphrase, salt, params = {}) {
  const {
    N = SCRYPT_COST,
    r = SCRYPT_BLOCK_SIZE,
    p = SCRYPT_PARALLELIZATION
  } = params;

  return crypto.scryptSync(passphrase, salt, KEY_LENGTH, {
    N,
    r,
    p
  });
}

function encryptPrivateKey(privateKey, passphrase) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(privateKey, "utf8"),
    cipher.final()
  ]);

  return {
    version: 1,
    kdf: {
      name: "scrypt",
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK_SIZE,
      p: SCRYPT_PARALLELIZATION,
      salt: salt.toString("hex")
    },
    cipher: {
      name: "aes-256-gcm",
      iv: iv.toString("hex"),
      authTag: cipher.getAuthTag().toString("hex"),
      ciphertext: ciphertext.toString("hex")
    }
  };
}

function decryptPrivateKey(payload, passphrase) {
  if (payload.version !== 1) {
    throw new Error(`Unsupported encrypted key version: ${payload.version}`);
  }

  if (payload.kdf?.name !== "scrypt") {
    throw new Error(`Unsupported KDF: ${payload.kdf?.name}`);
  }

  if (payload.cipher?.name !== "aes-256-gcm") {
    throw new Error(`Unsupported cipher: ${payload.cipher?.name}`);
  }

  const salt = Buffer.from(payload.kdf.salt, "hex");
  const iv = Buffer.from(payload.cipher.iv, "hex");
  const authTag = Buffer.from(payload.cipher.authTag, "hex");
  const ciphertext = Buffer.from(payload.cipher.ciphertext, "hex");
  const key = deriveKey(passphrase, salt, payload.kdf);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let plaintext;
  try {
    plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString("utf8");
  } catch (error) {
    throw new Error("Failed to decrypt private key. Check the passphrase.");
  }

  return plaintext;
}

export {
  decryptPrivateKey,
  encryptPrivateKey
};

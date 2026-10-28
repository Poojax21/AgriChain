const crypto = require("crypto");
const { ethers } = require("ethers");
const { dbAsync } = require("./database");

const JWT_SECRET = process.env.JWT_SECRET || "agrichain_dev_auth_secret_key_change_in_production_2026";
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_TTL_SEC = 24 * 3600; // 24 hours

// Allowed dev/admin addresses
const DEFAULT_ADMIN = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266".toLowerCase();

/**
 * Generate a cryptographically secure nonce for SIWE challenge
 */
async function generateNonce(address = null) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const now = Date.now();
  const expiresAt = now + NONCE_TTL_MS;

  await dbAsync.run(
    `INSERT INTO auth_nonces (nonce, address, created_at, expires_at, used)
     VALUES (?, ?, ?, ?, 0)`,
    [nonce, address ? address.toLowerCase() : null, now, expiresAt]
  );

  return {
    nonce,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAt).toISOString()
  };
}

/**
 * Format a standard EIP-4361 SIWE message
 */
function createSiweMessage({ domain, address, uri, version = "1", chainId = 31337, nonce, issuedAt, statement }) {
  const cleanAddress = ethers.getAddress(address);
  const stmt = statement || "Sign in to AgriChain decentralized marketplace.";
  return `${domain} wants you to sign in with your Ethereum account:\n${cleanAddress}\n\n${stmt}\n\nURI: ${uri}\nVersion: ${version}\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
}

/**
 * Parse an EIP-4361 formatted string into its components
 */
function parseSiweMessage(message) {
  const lines = message.split("\n");
  if (lines.length < 5) return null;

  const headerMatch = lines[0].match(/^(.+) wants you to sign in with your Ethereum account:$/);
  if (!headerMatch) return null;
  const domain = headerMatch[1].trim();
  const address = lines[1].trim();

  let uri = "";
  let version = "1";
  let chainId = 31337;
  let nonce = "";
  let issuedAt = "";
  let expirationTime = "";

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("URI: ")) uri = line.slice(5).trim();
    else if (line.startsWith("Version: ")) version = line.slice(9).trim();
    else if (line.startsWith("Chain ID: ")) chainId = parseInt(line.slice(10).trim(), 10);
    else if (line.startsWith("Nonce: ")) nonce = line.slice(7).trim();
    else if (line.startsWith("Issued At: ")) issuedAt = line.slice(11).trim();
    else if (line.startsWith("Expiration Time: ")) expirationTime = line.slice(17).trim();
  }

  return { domain, address, uri, version, chainId, nonce, issuedAt, expirationTime };
}

/**
 * Verify a SIWE signature and validate nonce
 */
async function verifySiweSignature({ message, signature, expectedAddress = null, expectedChainId = null, expectedDomain = null }) {
  if (!message || !signature) {
    throw new Error("Message and signature are required.");
  }

  const parsed = parseSiweMessage(message);
  if (!parsed || !parsed.address || !parsed.nonce) {
    throw new Error("Invalid or unparseable EIP-4361 message format.");
  }

  // 1. Verify cryptographic signature recovery
  let recovered;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch (err) {
    throw new Error(`Signature verification failed: ${err.message}`);
  }

  if (recovered.toLowerCase() !== parsed.address.toLowerCase()) {
    throw new Error(`Signature mismatch: recovered ${recovered} does not match ${parsed.address}.`);
  }

  if (expectedAddress && recovered.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(`Address mismatch: recovered ${recovered} does not match expected ${expectedAddress}.`);
  }

  // 2. Validate Domain and Chain ID if specified
  if (expectedDomain && parsed.domain.toLowerCase() !== expectedDomain.toLowerCase()) {
    throw new Error(`Domain mismatch: ${parsed.domain} does not match expected ${expectedDomain}.`);
  }
  if (expectedChainId && parsed.chainId !== expectedChainId) {
    throw new Error(`Chain ID mismatch: ${parsed.chainId} does not match expected ${expectedChainId}.`);
  }

  // 3. Validate Nonce single-use and expiration
  const nonceRow = await dbAsync.get("SELECT * FROM auth_nonces WHERE nonce = ?", [parsed.nonce]);
  if (!nonceRow) {
    throw new Error("Invalid nonce: nonce was never issued by this server.");
  }

  if (Number(nonceRow.used) === 1) {
    throw new Error("Replay attack detected: nonce has already been used.");
  }

  const now = Date.now();
  if (now > Number(nonceRow.expires_at)) {
    throw new Error("Nonce has expired. Please request a new authentication challenge.");
  }

  if (parsed.expirationTime && now > new Date(parsed.expirationTime).getTime()) {
    throw new Error("Authentication request has expired according to message expiration time.");
  }

  // Mark nonce used atomically
  await dbAsync.run("UPDATE auth_nonces SET used = 1 WHERE nonce = ?", [parsed.nonce]);

  return {
    valid: true,
    address: recovered.toLowerCase(),
    domain: parsed.domain,
    chainId: parsed.chainId
  };
}

/**
 * Create a base64url signed session token using HMAC-SHA256
 */
function createSessionToken(address) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: address.toLowerCase(),
      iat: nowSec,
      exp: nowSec + TOKEN_TTL_SEC
    })
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

/**
 * Verify session token and return decoded payload
 */
function verifySessionToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const expectedSig = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const nowSec = Math.floor(Date.now() / 1000);
    if (data.exp && nowSec > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Express middleware to authenticate token if present
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"] || req.headers["x-auth-token"];
  if (authHeader) {
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
    const decoded = verifySessionToken(token);
    if (decoded && decoded.sub) {
      req.user = { address: decoded.sub.toLowerCase() };
    }
  }
  next();
}

/**
 * Express middleware: requires valid authentication
 */
function requireAuth(req, res, next) {
  authenticateToken(req, res, () => {
    if (!req.user || !req.user.address) {
      return res.status(401).json({
        success: false,
        error: "Authentication required. Please authenticate with your Web3 wallet signature."
      });
    }
    next();
  });
}

/**
 * Express middleware: requires administrative rights
 */
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    const caller = req.user.address.toLowerCase();
    const configuredAdmin = (process.env.ADMIN_ADDRESS || DEFAULT_ADMIN).toLowerCase();

    if (caller !== configuredAdmin && caller !== DEFAULT_ADMIN) {
      return res.status(403).json({
        success: false,
        error: "Forbidden. Administrative wallet privileges required for this operation."
      });
    }
    next();
  });
}

/**
 * Validates actual binary file signatures (magic bytes) to prevent MIME spoofing
 */
function isValidImageBuffer(buffer) {
  if (!buffer || buffer.length < 4) return false;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true;
  // WebP: RIFF ... WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return true;
  // GIF: GIF8
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return true;
  return false;
}

module.exports = {
  generateNonce,
  createSiweMessage,
  parseSiweMessage,
  verifySiweSignature,
  createSessionToken,
  verifySessionToken,
  authenticateToken,
  requireAuth,
  requireAdmin,
  isValidImageBuffer,
  DEFAULT_ADMIN
};

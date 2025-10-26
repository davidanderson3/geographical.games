const fs = require('fs');
const path = require('path');

let cachedCredential = null;

function parseJsonMaybe(secret, sourceLabel) {
  try {
    return JSON.parse(secret);
  } catch (err) {
    throw new Error(`Failed to parse Firebase service account JSON from ${sourceLabel}: ${err.message}`);
  }
}

function tryLoadFromPath(candidatePath) {
  if (!candidatePath) return null;
  const resolvedPath = path.isAbsolute(candidatePath)
    ? candidatePath
    : path.resolve(process.cwd(), candidatePath);
  if (!fs.existsSync(resolvedPath)) return null;
  const contents = fs.readFileSync(resolvedPath, 'utf8');
  return parseJsonMaybe(contents, resolvedPath);
}

function loadFirebaseServiceAccount({
  fallbackPaths = [
    path.resolve(process.cwd(), 'serviceAccountKey.json'),
    path.resolve(__dirname, '../serviceAccountKey.json'),
    path.resolve(__dirname, '../scripts/serviceAccountKey.json')
  ],
  force = false
} = {}) {
  if (!force && cachedCredential) {
    return cachedCredential;
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    cachedCredential = parseJsonMaybe(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, 'FIREBASE_SERVICE_ACCOUNT_JSON env var');
    return cachedCredential;
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
    cachedCredential = parseJsonMaybe(decoded, 'FIREBASE_SERVICE_ACCOUNT_BASE64 env var');
    return cachedCredential;
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const fromEnvPath = tryLoadFromPath(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (fromEnvPath) {
      cachedCredential = fromEnvPath;
      return cachedCredential;
    }
  }

  for (const candidate of fallbackPaths) {
    const credential = tryLoadFromPath(candidate);
    if (credential) {
      cachedCredential = credential;
      return cachedCredential;
    }
  }

  throw new Error('Firebase service account credentials were not found. Provide them via FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_SERVICE_ACCOUNT_BASE64, FIREBASE_SERVICE_ACCOUNT, or a fallback file.');
}

module.exports = {
  loadFirebaseServiceAccount
};

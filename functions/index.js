const { setGlobalOptions } = require('firebase-functions/v2');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const functionsConfig = require('firebase-functions').config();

const serviceAccountSecret = defineSecret('SERVICE_ACCOUNT_JSON');

setGlobalOptions({
  region: 'us-central1',
  secrets: [serviceAccountSecret]
});

if (functionsConfig && functionsConfig.app && functionsConfig.app.allowed_origins && !process.env.ALLOWED_ORIGINS) {
  process.env.ALLOWED_ORIGINS = functionsConfig.app.allowed_origins;
}

const { app } = require('geographical-games-backend');

exports.app = onRequest((req, res) => {
  const secretValue = serviceAccountSecret.value();
  if (secretValue && !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = secretValue;
  }
  return app(req, res);
});

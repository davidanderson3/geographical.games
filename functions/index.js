const { onRequest } = require('firebase-functions/v2/https');
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const app = express();

// Enable CORS
app.use(cors({ origin: true }));

// Helper function to read geoscore overrides
function readGeoscoreOverrides() {
  try {
    const ovPath = path.join(__dirname, 'geoscore-overrides.json');
    const data = JSON.parse(fs.readFileSync(ovPath, 'utf8'));
    return data || {};
  } catch (err) {
    console.error('Error reading geoscore overrides:', err);
    return {};
  }
}

// Basic health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

// Auth verification endpoint
app.post('/auth/verify', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ error: 'No ID token provided' });
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    res.json({ user: decodedToken });
  } catch (error) {
    console.error('Auth verification error:', error);
    res.status(500).json({ error: 'Failed to verify token' });
  }
});

// Geoscore overrides endpoint
app.get('/geoscore-overrides', (req, res) => {
  const ov = readGeoscoreOverrides();
  const out = {
    answerOverrides: ov.answerOverrides || {},
    weightOverrides: ov.weightOverrides || {},
    removedAnswers: ov.removedAnswers || {},
    removedQuestions: ov.removedQuestions || {},
    weightByCountry: ov.weightByCountry || {},
    weightByCity: ov.weightByCity || {}
  };
  // Cache for 1 hour
  res.set('Cache-Control', 'public, max-age=3600');
  res.json(out);
});

// Export the Express app as a Cloud Function
exports.app = onRequest((req, res) => app(req, res));

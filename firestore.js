import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Firebase Admin SDK
let db = null;

try {
  // Option 1: Use service account key file (for local development)
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  
  // Option 2: Use service account JSON from environment variable (for production/Firebase hosting)
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  
  if (serviceAccountPath) {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase initialized with service account file');
  } else if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase initialized with service account from environment');
  } else {
    // Option 3: Use default credentials (when running on Firebase/GCP)
    admin.initializeApp({
      credential: admin.credential.applicationDefault()
    });
    console.log('Firebase initialized with default credentials');
  }
  
  db = admin.firestore();
  
  // Configure Firestore settings
  db.settings({
    ignoreUndefinedProperties: true
  });
  
} catch (error) {
  console.error('Failed to initialize Firebase:', error.message);
  console.error('Please ensure you have set up Firebase credentials properly.');
  console.error('See env.example for configuration options.');
  process.exit(1);
}

// Helper function to get current timestamp
export function getNow() {
  return Date.now();
}

// Helper function to get Firestore server timestamp
export function getServerTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

// Helper function to increment a field
export function increment(value) {
  return admin.firestore.FieldValue.increment(value);
}

export { db, admin };
export default db;

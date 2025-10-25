// Firebase Client SDK Configuration
// This file initializes Firebase for the frontend/client-side code

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyD1cH55nyjNRcpXnWCgEBHKsutYTnLbQt8",
  authDomain: "equinox-b1604.firebaseapp.com",
  projectId: "equinox-b1604",
  storageBucket: "equinox-b1604.firebasestorage.app",
  messagingSenderId: "752173466191",
  appId: "1:752173466191:web:6da85b3e6c0aa86527e03a",
  measurementId: "G-75PH8JT8R5"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);

// Export for use in other modules
export { app, analytics, auth, db };

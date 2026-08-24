// ============================================================
// FIREBASE SETUP — shared by script.js (public site) and admin.js (applications page)
// 1. Go to https://console.firebase.google.com → Create project.
// 2. Project settings → General → "Your apps" → Add a Web app.
//    Copy the config object it gives you and paste it below.
// 3. Build → Firestore Database → Create database (production mode).
// 4. Build → Authentication → Sign-in method → enable "Email/Password".
// 5. Authentication → Users → Add user, one per team lead who should
//    be able to publish blog posts, add teammates to the roster, and
//    view submitted applications (e.g. captain@iiperacing.example).
// 6. Firestore → Rules, paste the ruleset from the setup notes you
//    were given in chat (covers "posts", "applications", "team"), then Publish.
//
// Photos (blog posts + team roster) are resized/compressed client-side and
// stored inline in Firestore as base64 — no Firebase Storage / billing plan
// required, everything stays on the free Spark plan.
//
// This file only initializes the shared app/auth/db instances — edit the
// config below once and both pages pick it up automatically.
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB7N_JH41t35aLbNuZqXiY8S20N9CILDcw",
  authDomain: "fsae-59e13.firebaseapp.com",
  projectId: "fsae-59e13",
  storageBucket: "fsae-59e13.firebasestorage.app",
  messagingSenderId: "815064148964",
  appId: "1:815064148964:web:425515bc5eff8c6566f5f1",
  measurementId: "G-ZXLFGM5QPD"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

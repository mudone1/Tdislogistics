"use client";

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type Auth,
} from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, type Firestore } from "firebase/firestore";

// Firebase config is read from env vars so real credentials never live in
// source control. Copy .env.local.example to .env.local and fill these in
// (see FIREBASE_SETUP.md carried over from the original project).
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let firebaseReady = false;

export function getFirebase() {
  if (typeof window === "undefined") return { app: null, auth: null, db: null, ready: false };
  if (!firebaseReady) {
    try {
      if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
        throw new Error("Firebase env vars not configured — running in offline/local-only mode.");
      }
      app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      auth = getAuth(app);
      db = getFirestore(app);
      firebaseReady = true;
    } catch (e) {
      console.warn("[firebase] init skipped:", (e as Error).message);
      app = null;
      auth = null;
      db = null;
      firebaseReady = false;
    }
  }
  return { app, auth, db, ready: firebaseReady };
}

export const authHelper = {
  signIn: (email: string, password: string) => {
    const { auth } = getFirebase();
    if (!auth) return Promise.reject(new Error("Firebase not configured"));
    return signInWithEmailAndPassword(auth, email, password);
  },
  signUp: (email: string, password: string) => {
    const { auth } = getFirebase();
    if (!auth) return Promise.reject(new Error("Firebase not configured"));
    return createUserWithEmailAndPassword(auth, email, password);
  },
  signOut: () => {
    const { auth } = getFirebase();
    if (!auth) return Promise.resolve();
    return signOut(auth);
  },
  onAuthStateChanged: (cb: Parameters<typeof onAuthStateChanged>[1]) => {
    const { auth } = getFirebase();
    if (!auth) return () => {};
    return onAuthStateChanged(auth, cb);
  },
};

// ─── FIRESTORE SYNC HELPERS ───
// Mirrors the original app's pattern: each "collection" is actually a single
// document (tdis_data/{colName}) holding a JSON-stringified array/object.
// Falls back to localStorage when Firebase isn't configured.

export async function fsSave(colName: string, data: unknown): Promise<void> {
  try {
    const { db } = getFirebase();
    if (!db) return;
    await setDoc(doc(db, "tdis_data", colName), { data: JSON.stringify(data) });
  } catch (e) {
    console.warn("Firestore save failed:", e);
  }
}

export async function fsLoad<T>(colName: string, localKey: string, fallback: T): Promise<T> {
  try {
    const { db } = getFirebase();
    if (db) {
      const snap = await getDoc(doc(db, "tdis_data", colName));
      if (snap.exists()) {
        const parsed = JSON.parse((snap.data() as { data: string }).data) as T;
        if (typeof window !== "undefined") localStorage.setItem(localKey, JSON.stringify(parsed));
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Firestore load failed, using localStorage:", e);
  }
  if (typeof window === "undefined") return fallback;
  const local = localStorage.getItem(localKey);
  return local ? (JSON.parse(local) as T) : fallback;
}

export function fsListen<T>(colName: string, callback: (data: T) => void): () => void {
  const { db } = getFirebase();
  if (!db) return () => {};
  return onSnapshot(
    doc(db, "tdis_data", colName),
    (snap) => {
      if (snap.exists()) {
        try {
          callback(JSON.parse((snap.data() as { data: string }).data) as T);
        } catch {
          /* ignore malformed payloads */
        }
      }
    },
    (e) => console.warn("Firestore listener error:", e)
  );
}

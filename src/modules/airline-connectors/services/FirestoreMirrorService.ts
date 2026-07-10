import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { AirlineKey } from "../core/types";
import { airlineKeyToDisplayName } from "../core/airlineNameMap";

/**
 * Mirrors a successful sync's balance into the SAME Firestore document the
 * existing client app already listens to in real time
 * (src/lib/firebase.ts -> fsListen<Balance[]>("balances", ...), consumed by
 * src/lib/store.tsx). No client-side code changes needed — the moment this
 * write lands, every open dashboard tab updates itself and (per the store
 * change below) shows a toast.
 *
 * Document shape MUST exactly match what the client writes via fsSave():
 *   tdis_data/balances -> { data: JSON.stringify(Balance[]) }
 * where Balance = { airline: string; balance: number; updated: string }.
 */

let app: App | null = null;

function getAdminApp(): App | null {
  if (app) return app;
  if (getApps().length) {
    app = getApps()[0];
    return app;
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  // Private keys in env vars usually have literal "\n" that need converting
  // back to real newlines.
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    console.warn(
      "[FirestoreMirrorService] FIREBASE_ADMIN_* env vars not fully set — " +
        "skipping Firestore mirror. Balance is still saved to PostgreSQL."
    );
    return null;
  }

  app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  return app;
}

interface MirroredBalance {
  airline: string;
  balance: number;
  updated: string;
}

export async function mirrorBalanceToFirestore(airlineKey: AirlineKey, balance: number): Promise<void> {
  const adminApp = getAdminApp();
  if (!adminApp) return;

  const db = getFirestore(adminApp);
  const docRef = db.collection("tdis_data").doc("balances");
  const displayName = airlineKeyToDisplayName(airlineKey);
  const updatedLabel = new Date().toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    let current: MirroredBalance[] = [];
    if (snap.exists) {
      try {
        current = JSON.parse((snap.data() as { data: string }).data) as MirroredBalance[];
      } catch {
        current = [];
      }
    }

    const idx = current.findIndex((b) => b.airline === displayName);
    const entry: MirroredBalance = { airline: displayName, balance, updated: `${updatedLabel} (synced)` };
    if (idx >= 0) current[idx] = entry;
    else current.push(entry);

    tx.set(docRef, { data: JSON.stringify(current) });
  });
}

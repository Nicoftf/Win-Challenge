// ============================================================
//  Konfiguration
// ============================================================
//
//  firebaseConfig = null  →  LOKALER MODUS
//     Alles wird nur in diesem Browser gespeichert. Gut zum
//     Ausprobieren, aber kein Sync zwischen Personen und kein
//     OBS-Overlay (OBS ist ein eigener Browser).
//
//  firebaseConfig = { ... }  →  ONLINE MODUS (empfohlen)
//     Kostenloses Firebase-Projekt, Anleitung in README.md.
//     Die Werte hier sind KEIN Geheimnis – der Schutz ist der
//     lange Raum-Code, den nur ihr vier kennt.
//
export const firebaseConfig = null;

/* Beispiel (Werte aus der Firebase-Konsole einfügen):
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "win-challenge-xxxx.firebaseapp.com",
  databaseURL: "https://win-challenge-xxxx-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "win-challenge-xxxx",
  storageBucket: "win-challenge-xxxx.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef",
};
*/

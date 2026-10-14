# Kran-Wartung

Handy-App (PWA) zur Wartung von Kranen – funktioniert offline, alle Daten bleiben auf dem Gerät.

- Kräne mit Stammdaten (Typ, Hersteller, Seriennr., Standort, Traglast …)
- Wartungs- und UVV-Prüfintervalle mit Fälligkeitsübersicht (überfällig / bald fällig)
- Einträge: Wartung, UVV-Prüfung, Inspektion, Reparatur, Störung
- Checkliste mit Prüfpunkten (OK / Mangel / n. a.), eigene Prüfpunkte, Fotos
- Offene Mängel verfolgen und als behoben markieren
- Bericht teilen (WhatsApp, Mail …), Backup als JSON, Export als CSV für Excel

## Aufs Handy bringen

1. Auf GitHub: **Settings → Pages → Source: Deploy from a branch → `master` / `(root)`** → Save.
2. Nach ca. 1 Minute die angezeigte Adresse (z. B. `https://<name>.github.io/kran-app/`) auf dem Handy öffnen.
3. **iPhone (Safari):** Teilen → „Zum Home-Bildschirm“. **Android (Chrome):** ⋮ → „App installieren“.

Lokal testen: `python3 -m http.server` und `http://localhost:8000` öffnen.

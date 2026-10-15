# Kran-Wartung

Handy-App (PWA) zur Wartung von Kranen – für mehrere Benutzer mit Abgleich über den eigenen Server (z. B. UGREEN NAS), funktioniert auch offline.

- Kräne mit Stammdaten (Typ, Hersteller, Seriennr., Standort, Traglast …)
- Wartungs- und UVV-Prüfintervalle mit Fälligkeitsübersicht (überfällig / bald fällig)
- Einträge: Wartung, UVV-Prüfung, Inspektion, Reparatur, Störung
- Checkliste mit Prüfpunkten (OK / Mangel / n. a.), eigene Prüfpunkte, Fotos
- Offene Mängel verfolgen und als behoben markieren
- Bericht teilen (WhatsApp, Mail …), Backup als JSON, Export als CSV für Excel
- Mehrere Benutzer mit Login, Abgleich aller Geräte über den Server

## Installation auf dem UGREEN NAS (Docker)

Bei jedem Push auf `master` baut GitHub automatisch ein Docker-Image:
`ghcr.io/mtyft5pfmt-alt/kran-app:latest`

1. Auf GitHub unter **Packages → kran-app → Package settings** die Sichtbarkeit auf **Public** stellen
   (sonst muss sich das NAS bei ghcr.io anmelden).
2. Im UGOS: **Docker → Projekt → Erstellen**, Ordner wählen (z. B. `/docker/kran-app`) und den Inhalt
   von [`docker-compose.yml`](docker-compose.yml) einfügen. **`ADMIN_PASSWORD` ändern!** Dann bereitstellen.
3. Im Browser `http://<NAS-IP>:8090` öffnen und mit `admin` + dem Passwort anmelden.
4. Unter **Mehr → Benutzer verwalten** Kollegen anlegen.

Die Datenbank liegt im Projektordner unter `data/` – diesen Ordner ins NAS-Backup aufnehmen.

**Update:** Im UGOS-Docker beim Projekt das Image neu ziehen bzw. das Projekt neu bereitstellen.

### Zugriff von unterwegs und als App installieren

Im eigenen WLAN geht es über `http://<NAS-IP>:8090`. Für die Installation als App, den Offline-Modus
und den Zugriff von unterwegs braucht die Seite **HTTPS**, z. B.:

- **Cloudflare Tunnel** (kostenlos, braucht eine eigene Domain bei Cloudflare): siehe unten.
- **Tailscale** (nichts wird öffentlich): Tailscale auf NAS und Handys, dann `tailscale serve`
  bzw. die HTTPS-Adresse des NAS im Tailnet verwenden.
- **Reverse Proxy** mit eigener Domain und Let's-Encrypt-Zertifikat auf Port 8090.

### Cloudflare Tunnel einrichten

1. Domain bei Cloudflare anlegen (oder dort kaufen) – kostenloser Tarif reicht.
2. Cloudflare Dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** → Typ **Cloudflared**,
   Name z. B. `nas`. Bei „Install connector“ **Docker** wählen und nur den Token (langer Text nach `--token`) kopieren.
3. Unter **Public Hostname** hinzufügen: Subdomain `kran`, Domain wählen, Service **HTTP** → `kran-app:8080`.
4. Im UGOS das Projekt mit [`docker-compose.cloudflare.yml`](docker-compose.cloudflare.yml) anlegen
   (bzw. das bestehende Projekt damit ersetzen), Token und Admin-Passwort eintragen.
5. Auf allen Handys `https://kran.<deine-domain>` öffnen und als App zum Startbildschirm hinzufügen.

Kein Port am Router freigeben – der Tunnel baut die Verbindung von innen nach außen auf.

## Ohne Server

Über GitHub Pages (`https://mtyft5pfmt-alt.github.io/Kran-App/`) läuft die App ohne Login,
die Daten bleiben dann nur auf dem jeweiligen Gerät. Ein dort erstelltes Backup lässt sich in der
Server-Version unter **Mehr → Backup importieren** einspielen.

## Lokal entwickeln

```
ADMIN_PASSWORD=test123 node server/server.js   # Node.js 22.13+
```
→ http://localhost:8080

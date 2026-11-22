# matchdesk-billiard

**Bandenduell** (Arbeitstitel) ist ein 8-Ball-Poolbillard für zwei Spieler im Browser: Draufsicht, Lobby, Tische mit Einladungslink, Chat. Gespielt wird online zwischen zwei Geräten, auch am Smartphone. Die Anbindung an die Mitspielzentrale ([Matchdesk](https://github.com/containerguy/Matchdesk)) ist als Erweiterung vorgesehen.

Dieses Repository enthält nur das Billard. Weitere Spiele bekommen jeweils ein eigenes Repository.

Plan und Architektur: [Online-Billard: Recherche und Umsetzungsplan](https://claude.ai/artifact/PbZiA48ECrTHXitU9rHEnA)

## Stand

- **Physik:** deterministische 2D-Kugelphysik (fester Zeitschritt 1/480 s), Banden, Taschen, Vor- und Rücklauf, seitliches Effet an der Bande.
- **8-Ball-Regeln:** Anstoß, offener Tisch, Volle gegen Halbe, Fouls mit Kugel in der Hand, Sieg und Niederlage über die 8.
- **Online:** Spielserver mit Lobby, öffentlichen und privaten Tischen (Code und Einladungslink), Chat, Revanche, Wiederverbinden nach Verbindungsabbruch (60 s Frist). Der Server rechnet jeden Stoß selbst, beide Seiten sehen denselben Ablauf und das Zielen des Gegners.
- **Smartphone:** Touch-Steuerung (Finger zielt, Regler für die Stärke, Knopf „Stoß“) und Layout für Hoch- und Querformat.
- **Allein üben:** lokaler Tisch ohne Gegner.

Als Nächstes: Computergegner für Solo-Partien, Rangliste, Anbindung an Matchdesk.

## Aufbau

```text
packages/core      Spiel-Schnittstelle (GameDefinition)
packages/protocol  Nachrichten zwischen Client und Server (zod-geprüft)
games/billard      Physik, Dreieck, Zielhilfe, 8-Ball-Regeln (rein, deterministisch, getestet)
apps/server        Express + WebSocket: Lobby, Tische, Schiedsrichter
apps/client        Vite + React + PixiJS: Lobby, Tisch, Steuerung
```

## Entwickeln

```bash
npm install
npm run dev        # Server auf :3000, Client auf http://localhost:5173
npm test           # Unit-Tests (Vitest)
npm run typecheck
```

Der Client ist im Entwicklungsmodus auch im lokalen Netz erreichbar (`http://<IP-des-Rechners>:5173`), so lässt sich ein zweites Gerät oder ein Smartphone direkt testen.

## Betreiben

Ein Prozess liefert Client und WebSocket (`/ws`) auf einem Port aus.

```bash
npm ci
npm run build      # baut den Client nach apps/client/dist
npm start          # Server auf Port 3000 (PORT=... zum Ändern)
```

Oder mit Docker:

```bash
docker compose up -d --build   # http://localhost:3000
```

Für den Betrieb im Internet einen Reverse-Proxy mit HTTPS davorsetzen, der WebSocket-Verbindungen auf `/ws` durchreicht. `GET /health` meldet den Zustand. Der Spielstand liegt im Arbeitsspeicher, ein Neustart beendet laufende Partien.

## Bedienung

- Weiße Kugel setzen: Klick oder Tipp (beim Anstoß links der Kopflinie).
- Maus: bewegen zielt, Maustaste halten und zurückziehen bestimmt die Stärke, loslassen stößt.
- Touch: Finger auf dem Tisch dreht den Queue, Stärke am Regler, dann „Stoß“.
- Effet: auf der kleinen weißen Kugel den Treffpunkt wählen.
- Zielhilfe „Profi“ zeigt nur noch die Linie bis zur Geisterkugel.

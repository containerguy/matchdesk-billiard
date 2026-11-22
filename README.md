# matchdesk-billiard

**Bandenduell** (Arbeitstitel) ist ein 8-Ball-Poolbillard für zwei Spieler im Browser: Draufsicht, Lobby, Tische mit Einladungslink, Chat. Gespielt wird online zwischen zwei Geräten, auch am Smartphone. Die Anbindung an die Mitspielzentrale ([Matchdesk](https://github.com/containerguy/Matchdesk)) ist als Erweiterung vorgesehen.

Dieses Repository enthält nur das Billard. Weitere Spiele bekommen jeweils ein eigenes Repository.

Plan und Architektur: [Online-Billard: Recherche und Umsetzungsplan](https://claude.ai/artifact/PbZiA48ECrTHXitU9rHEnA)

## Stand

- **Physik:** deterministische 2D-Kugelphysik (fester Zeitschritt 1/480 s), Banden, Taschen, Vor- und Rücklauf, seitliches Effet an der Bande.
- **8-Ball-Regeln:** Anstoß aus dem Kopffeld (gültig, wenn eine Kugel fällt oder vier Kugeln eine Bande erreichen, sonst Neuaufbau und der Gegner stößt an), offener Tisch, Volle gegen Halbe, Fouls mit Kugel in der Hand, nach versenkter Weißer beim Anstoß nur im Kopffeld, Sieg und Niederlage über die 8.
- **Online:** Spielserver mit Lobby, öffentlichen und privaten Tischen (Code und Einladungslink), Chat, Revanche, Wiederverbinden nach Verbindungsabbruch (60 s Frist). Der Server rechnet jeden Stoß selbst, beide Seiten sehen denselben Ablauf und das Zielen des Gegners.
- **Smartphone:** Touch-Steuerung (Finger zielt, Regler für die Stärke, Knopf „Stoß“) und Layout für Hoch- und Querformat.
- **Solo:** Partie gegen den Computer in drei Stufen (Leicht, Mittel, Schwer) oder freies Üben ohne Gegner. Der Computergegner läuft im Browser und braucht keinen Server.

Als Nächstes: Anbindung an Matchdesk, Rangliste.

## Aufbau

```text
packages/core      Spiel-Schnittstelle (GameDefinition)
packages/protocol  Nachrichten zwischen Client und Server (zod-geprüft)
games/billard      Physik, Dreieck, Zielhilfe, 8-Ball-Regeln, Computergegner (rein, deterministisch, getestet)
apps/server        Express + WebSocket: Lobby, Tische, Schiedsrichter
apps/client        Vite + React + PixiJS: Lobby, Tisch, Steuerung
e2e                End-to-End-Tests (Playwright)
```

## Entwickeln

```bash
npm install
npm run dev        # Server auf :3000, Client auf http://localhost:5173
npm test           # Unit-Tests (Vitest)
npm run typecheck
npm run test:e2e   # End-to-End-Tests im Browser (Playwright)
```

Der Client ist im Entwicklungsmodus auch im lokalen Netz erreichbar (`http://<IP-des-Rechners>:5173`), so lässt sich ein zweites Gerät oder ein Smartphone direkt testen.

## End-to-End-Tests

Die Tests unter `e2e/` bauen den Client, starten den echten Spielserver und spielen im Browser: eine Online-Partie zwischen Desktop und Smartphone-Ansicht mit Einladungslink, Stößen, Chat und Aufgabe, eine Online-Partie bis zum Ende mit Revanche und eine Solo-Partie gegen den Computer bis zum Ende. Sie laufen in der CI als eigener Check `e2e` und sind Pflicht: ohne grüne E2E-Tests wird nicht gemergt. Wer eine Funktion ändert oder ergänzt, die Spieler bedienen, ergänzt den passenden Test.

Einmalig vor dem ersten lokalen Lauf: `npx playwright install chromium`.

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

Fertige Images baut der Workflow „Image“ bei jedem Push auf `main`: `ghcr.io/containerguy/matchdesk-billiard:latest`
und `:sha-<commit>`, bei Tags `v1.2.3` zusätzlich `:1.2.3`. In PRs wird das Image nur gebaut und unter
`/game-servers/billiard` kurz gestartet (Rauchtest).

Für den Betrieb im Internet einen Reverse-Proxy mit HTTPS davorsetzen, der WebSocket-Verbindungen auf `/ws` durchreicht. `GET /health` meldet den Zustand. Der Spielstand liegt im Arbeitsspeicher, ein Neustart beendet laufende Partien.

## Bedienung

- Weiße Kugel setzen: Klick oder Tipp (beim Anstoß links der Kopflinie).
- Maus: bewegen zielt, Maustaste halten und zurückziehen bestimmt die Stärke, loslassen stößt.
- Touch: Finger auf dem Tisch dreht den Queue, Stärke am Regler, dann „Stoß“.
- Effet: auf der kleinen weißen Kugel den Treffpunkt wählen.
- Zielhilfe „Profi“ zeigt nur noch die Linie bis zur Geisterkugel.

## Einbindung in Matchdesk und andere Plattformen

Der Server bietet unter `<BASE_PATH>/api/integrations/v1` eine kleine HTTP-Schnittstelle, mit der eine
Plattform wie Matchdesk Partien zwischen ihren Benutzern anlegt. Das Spiel läuft dann eingebettet in der
Plattform (`?embed=1`), jeder Spieler kommt über seinen persönlichen Platz-Link (`?seat=<token>`) an den Tisch.

| Umgebungsvariable | Bedeutung |
| --- | --- |
| `BASE_PATH` | Unterpfad hinter dem Reverse Proxy, z. B. `/game-servers/billiard` (leer = Wurzel) |
| `INTEGRATION_API_KEY` | Schlüssel für `Authorization: Bearer …`; ohne ihn ist die Schnittstelle aus |
| `INTEGRATION_WEBHOOK_SECRET` | Geheimnis für die HMAC-Signatur der Ereignisse an die Plattform |
| `FRAME_ANCESTORS` | wer das Spiel einbetten darf (CSP `frame-ancestors`), Standard `'self'` |

| Methode und Pfad | Zweck |
| --- | --- |
| `POST /tables` | reservierten Tisch anlegen: `{ players: [{id, name}, {id, name}], ref?, name?, callbackUrl? }`, Antwort mit `seats[].token` |
| `GET /tables/:id` | Stand: Status, Spieler, Punkte, Sieger der letzten Partie |
| `DELETE /tables/:id` | Tisch schließen (z. B. abgesagte Herausforderung) |

Reservierte Tische haben zwei feste Plätze, verfallen nach 30 Minuten ohne Beitritt und werden nach zwei
Stunden ohne Spieler geschlossen. Ereignisse (`game.finished`, `table.expired`, `table.closed`) gehen als
`POST` an die `callbackUrl`, mit den Headern `X-Bandenduell-Timestamp` und
`X-Bandenduell-Signature: sha256=HMAC(secret, "<timestamp>.<body>")`.

Eingebettet meldet das Spiel dem umgebenden Fenster per `postMessage` (nur an die eigene Herkunft)
`{ source: "bandenduell", type: "ready" | "status" | "matchEnded" | "closed", status, score, mySeat, seats }`.

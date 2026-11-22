# matchdesk-billiard

Online-Spiele für zwei Spieler im Browser, mit Lobbies und späterer Anbindung an die Mitspielzentrale ([Matchdesk](https://github.com/containerguy/Matchdesk)). Erstes Spiel ist **Bandenduell** (Arbeitstitel), ein 8-Ball-Poolbillard in der Draufsicht. Ein Schiebe-Puzzle für zwei Spieler folgt später.

Plan und Architektur: [Online-Billard: Recherche und Umsetzungsplan](https://claude.ai/artifact/PbZiA48ECrTHXitU9rHEnA)

## Stand

- **M0 Grundgerüst:** npm-Workspaces, TypeScript, Tests, CI.
- **M1 Physik-Prototyp:** deterministische 2D-Kugelphysik (fester Zeitschritt 1/480 s), Banden, Taschen, Vor- und Rücklauf, seitliches Effet an der Bande.
- **M2 8-Ball-Regeln:** Anstoß, offener Tisch, Volle gegen Halbe, Fouls mit Kugel in der Hand, Sieg und Niederlage über die 8.
- Spielbar als **lokale Partie an einem Rechner** (zwei Spieler abwechselnd).

Als Nächstes: Spielserver mit Tisch-Räumen und Lobby (M3, M4).

## Aufbau

```text
packages/core     Spiel-Schnittstelle (GameDefinition), unabhängig vom konkreten Spiel
games/billard     Physik, Dreieck, Zielhilfe, 8-Ball-Regeln (rein, deterministisch, getestet)
apps/client       Vite + React + PixiJS: Tisch, Steuerung, Spielverlauf
```

Lobby, Tische, Chat und Rangliste kennen später nur `GameDefinition`. Ein weiteres Spiel kommt als eigenes Paket unter `games/` dazu.

## Lokal starten

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Unit-Tests (Vitest)
npm run typecheck
npm run build
```

## Bedienung

- Weiße Kugel setzen: Klick (beim Anstoß links der Kopflinie).
- Zielen: Maus bewegen.
- Stoßen: Maustaste halten, zurückziehen (Stärke), loslassen.
- Effet: auf der kleinen weißen Kugel unter dem Tisch den Treffpunkt anklicken.
- Zielhilfe „Profi“ zeigt nur noch die Linie bis zur Geisterkugel.

# Lunch Bus

A shared "pack up now" alarm for 4 colleagues taking the bus to VivoCity at lunch.

**Problem:** The group misses the right bus because everyone checks a different app, decides on their own, and the WhatsApp "let's go" is easy to ignore.

**Live app:** https://caroltanjx-cmd.github.io/lunch-bus/

## How it works

- Every open page fetches [arrivelah](https://arrivelah2.busrouter.sg/?id=14249) every 15s for stop 14249 (Blk 1, Henderson Rd).
- It picks the earliest bus on a VivoCity route that is at least 17 min away (15 min to pack up and walk + 2 min buffer) and isn't at limited standing. Everyone runs the same logic on the same data, so everyone sees the same bus and countdown.
- Click **We're going for lunch** to turn on your alarm. At pack-up time the page shows a full-screen alert, chimes and sends a desktop notification until you tap **I'm on my way**.

Settings (stop, routes, walk time, buffer) are in `CONFIG` at the top of `app.js`.

## Run locally

```
npm start        # preview at http://localhost:3000
npm test         # bus-picking logic
```

## Known limits

- Only **bus 145** reaches VivoCity from stop 14249 (checked against busrouter.sg route data, 2026-10-06).
- arrivelah only lists the next ~3 buses (about 30 min ahead), so the bus is picked once it appears.
- Each person turns on their own alarm, and only an open page can ring. There's no shared check-in, because GitHub Pages can't run a server.
- Sound only plays after you've clicked somewhere on the page.

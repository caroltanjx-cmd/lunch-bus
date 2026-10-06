// Pure bus-picking logic. No I/O, so it can be tested with fixed clocks.

// LTA load codes: SEA = seats available, SDA = standing available, LSD = limited standing.
export const FULL_LOAD = "LSD";

const ARRIVAL_KEYS = ["next", "subsequent", "next2", "next3"];

// Flatten an arrivelah response into one time-sorted list of buses on the given routes.
export function busesFrom(services, routes) {
  const seen = new Set();
  const buses = [];
  for (const s of services ?? []) {
    if (!routes.includes(s.no)) continue;
    for (const key of ARRIVAL_KEYS) {
      const a = s[key];
      if (!a?.time) continue;
      const time = Date.parse(a.time);
      const id = `${s.no}@${time}`;
      if (seen.has(id)) continue; // arrivelah repeats `subsequent` as `next2`
      seen.add(id);
      buses.push({ no: s.no, time, load: a.load, type: a.type, wab: a.feature === "WAB", live: a.monitored === 1 });
    }
  }
  return buses.sort((a, b) => a.time - b.time);
}

// The earliest bus the group can still reach (at least `leadMs` away) that isn't packed.
export function pickBus(buses, now, leadMs) {
  return buses.find((b) => b.time - now >= leadMs && b.load !== FULL_LOAD) ?? null;
}

// Find the same physical bus in a fresh set of arrivals: same service, closest estimate within 5 min.
export function matchBus(buses, bus, windowMs = 5 * 60_000) {
  let best = null;
  for (const b of buses) {
    if (b.no !== bus.no) continue;
    const d = Math.abs(b.time - bus.time);
    if (d <= windowMs && (!best || d < Math.abs(best.time - bus.time))) best = b;
  }
  return best;
}

// Advance the shared lunch session by one tick.
// phase: "idle" (not going yet) → "armed" (alarm on) → "go" (pack up now) → back to "idle" after the bus leaves.
export function step(session, buses, now, cfg) {
  const { leadMs, graceMs = 60_000, doneAfterMs = 2 * 60_000 } = cfg;
  const s = { ...session };

  if (s.phase === "go") {
    const same = matchBus(buses, s.target);
    if (same) s.target = same;
    if (now > s.target.time + doneAfterMs) return { phase: "idle", target: null, goAt: null, coming: {} };
    return s;
  }

  // idle or armed: keep the current target while it's still catchable and not packed,
  // so it doesn't flip to the next bus the instant its pack-up time arrives.
  const same = s.target && matchBus(buses, s.target);
  const keep = same && same.load !== FULL_LOAD && same.time - now >= leadMs - graceMs;
  s.target = keep ? same : pickBus(buses, now, leadMs);

  if (s.phase === "armed" && s.target && now >= s.target.time - leadMs) {
    s.phase = "go";
    s.goAt = now;
  }
  return s;
}

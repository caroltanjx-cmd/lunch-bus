import { test } from "node:test";
import assert from "node:assert/strict";
import { busesFrom, pickBus, step } from "./planner.js";

const MIN = 60_000;
const T0 = Date.parse("2026-10-06T12:00:00+08:00");
const at = (m) => new Date(T0 + m * MIN).toISOString();
const arrival = (m, load = "SEA") => ({ time: at(m), load, feature: "WAB", type: "DD", monitored: 1 });
const cfg = { leadMs: 17 * MIN };

test("busesFrom keeps only VivoCity routes, dedupes and sorts", () => {
  const services = [
    { no: "145", next: arrival(20), subsequent: arrival(5), next2: arrival(5), next3: arrival(30) },
    { no: "176", next: arrival(1) },
  ];
  const buses = busesFrom(services, ["145"]);
  assert.deepEqual(buses.map((b) => (b.time - T0) / MIN), [5, 20, 30]);
});

test("pickBus skips buses too soon to reach and buses with limited standing", () => {
  const buses = busesFrom([{ no: "145", next: arrival(5), next2: arrival(20, "LSD"), next3: arrival(25) }], ["145"]);
  assert.equal((pickBus(buses, T0, cfg.leadMs).time - T0) / MIN, 25);
});

test("pickBus returns null when nothing is catchable", () => {
  const buses = busesFrom([{ no: "145", next: arrival(5) }], ["145"]);
  assert.equal(pickBus(buses, T0, cfg.leadMs), null);
});

test("armed session fires go at pack-up time and keeps the same bus", () => {
  const buses = busesFrom([{ no: "145", next: arrival(20), next2: arrival(32) }], ["145"]);
  let s = step({ phase: "armed", target: null, coming: {} }, buses, T0, cfg);
  assert.equal(s.phase, "armed");
  assert.equal(s.target.time, T0 + 20 * MIN);

  s = step(s, buses, T0 + 3 * MIN, cfg); // 20 - 17 = pack up at +3
  assert.equal(s.phase, "go");
  assert.equal(s.target.time, T0 + 20 * MIN);

  s = step(s, buses, T0 + 10 * MIN, cfg);
  assert.equal(s.phase, "go");
  assert.equal(s.target.time, T0 + 20 * MIN);
});

test("go follows the bus when its estimate shifts, then resets after it leaves", () => {
  let s = { phase: "go", target: { no: "145", time: T0 + 20 * MIN }, goAt: T0, coming: { Carol: T0 } };
  const later = busesFrom([{ no: "145", next: arrival(22), next2: arrival(35) }], ["145"]);
  s = step(s, later, T0 + 5 * MIN, cfg);
  assert.equal(s.target.time, T0 + 22 * MIN);

  s = step(s, later, T0 + 25 * MIN, cfg);
  assert.equal(s.phase, "idle");
  assert.deepEqual(s.coming, {});
});

test("target switches to a later bus if it fills up before pack-up", () => {
  let s = step({ phase: "armed", target: null, coming: {} },
    busesFrom([{ no: "145", next: arrival(20), next2: arrival(32) }], ["145"]), T0, cfg);
  s = step(s, busesFrom([{ no: "145", next: arrival(20, "LSD"), next2: arrival(32) }], ["145"]), T0 + MIN, cfg);
  assert.equal(s.target.time, T0 + 32 * MIN);
  assert.equal(s.phase, "armed");
});

const appCfg = { leadMs: 17 * MIN, graceMs: 2 * MIN }; // grace = buffer, as app.js passes it
const arrivalAt = (ms) => ({ ...arrival(0), time: new Date(T0 + ms).toISOString() });

test("armed session still fires go when the estimate jumps earlier just before pack-up", () => {
  let s = step({ phase: "armed", target: null, coming: {} },
    busesFrom([{ no: "145", next: arrival(20), next2: arrival(32) }], ["145"]), T0, appCfg);
  // At +2:57 the bus is now due at +18:54, 15:57 away: under the old 60s grace, but still reachable.
  const jumped = busesFrom([{ no: "145", next: arrivalAt(18.9 * MIN), next2: arrival(32) }], ["145"]);
  s = step(s, jumped, T0 + 2.95 * MIN, appCfg);
  assert.equal(s.phase, "go");
  assert.equal(s.target.time, T0 + 18.9 * MIN);
});

test("armed session moves to a later bus only once the picked one is too close to reach", () => {
  let s = step({ phase: "armed", target: null, coming: {} },
    busesFrom([{ no: "145", next: arrival(20), next2: arrival(32) }], ["145"]), T0, appCfg);
  // At +2 the estimate drops to +16, 14 min away: less than the 15 min walk.
  s = step(s, busesFrom([{ no: "145", next: arrival(16), next2: arrival(32) }], ["145"]), T0 + 2 * MIN, appCfg);
  assert.equal(s.phase, "armed");
  assert.equal(s.target.time, T0 + 32 * MIN);
});

test("a page opened later picks the same bus as one that has been open all along", () => {
  const buses = busesFrom([{ no: "145", next: arrival(20), next2: arrival(30) }], ["145"]);
  let early = { phase: "idle", target: null, coming: {} };
  for (let t = T0; t <= T0 + 6 * MIN; t += 15_000) {
    early = step(early, buses, t, appCfg);
    const late = step({ phase: "idle", target: null, coming: {} }, buses, t, appCfg); // just opened or reloaded
    assert.equal(late.target?.time, early.target?.time, `disagree at +${(t - T0) / 1000}s`);
  }
});

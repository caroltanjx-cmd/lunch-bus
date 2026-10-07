import { busesFrom, step } from "./planner.js";

const CONFIG = {
  stop: "14249",
  stopName: "Blk 1, Henderson Rd",
  destination: "VivoCity",
  // Services from 14249 that reach VivoCity (HarbourFront Stn Exit A), checked against
  // data.busrouter.sg route data on 2026-10-06. Only 145 does today.
  routes: ["145"],
  walkMin: 15, // pack up + walk to the stop
  bufferMin: 2, // slack so the group isn't sprinting
};
const leadMs = (CONFIG.walkMin + CONFIG.bufferMin) * 60_000;
// Keep a picked bus until it's closer than the walk, so a late estimate eats into the buffer
// instead of quietly moving the group to the next bus.
const graceMs = CONFIG.bufferMin * 60_000;
const POLL_MS = 15_000; // arrivelah caches for 15s
const LOAD = { SEA: "Seats", SDA: "Standing", LSD: "Full" };

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};
// The alarm stays on across reloads, but only for the day it was turned on, and only until it fires:
// a reload after that mustn't re-arm it for a later bus.
const today = () => new Date().toLocaleDateString("en-SG");
const ARMED_KEY = "lunchbus.armedOn";

let buses = [];
let fetchedAt = null;
let fetchError = null;
let session = { phase: store.get(ARMED_KEY) === today() ? "armed" : "idle", target: null, goAt: null, coming: {} };
let dismissedGoAt = null;

const clock = (t) => new Date(t).toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" });
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const mins = (ms) => {
  const m = Math.floor(ms / 60000);
  return m <= 0 ? "Arriving" : `${m} min`;
};

async function poll() {
  try {
    const r = await fetch(`https://arrivelah2.busrouter.sg/?id=${CONFIG.stop}`);
    if (!r.ok) throw new Error(`arrivelah answered ${r.status}`);
    buses = busesFrom((await r.json()).services, CONFIG.routes);
    fetchedAt = Date.now();
    fetchError = null;
  } catch (e) {
    fetchError = `Couldn't get bus times (${e.message}). Showing the last known times.`;
  }
  tick();
}

function tick() {
  const before = session.phase;
  session = step(session, buses, Date.now(), { leadMs, graceMs });
  if (before === "armed" && session.phase !== "armed") store.del(ARMED_KEY); // alarm has fired
  render();
}

// ---------- Sound: two-tone chime, repeated while the alarm is up ----------
let audio = null;
function unlockAudio() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
  } catch {}
}
document.addEventListener("pointerdown", unlockAudio);
document.addEventListener("keydown", unlockAudio);
function chime() {
  if (!audio || audio.state !== "running") return;
  const t = audio.currentTime;
  [880, 660, 880].forEach((f, i) => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = "square"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + i * 0.22);
    g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.22 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.22 + 0.2);
    o.connect(g).connect(audio.destination);
    o.start(t + i * 0.22); o.stop(t + i * 0.22 + 0.21);
  });
}

// ---------- Controls ----------
$("armBtn").addEventListener("click", () => {
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  store.set(ARMED_KEY, today());
  session = { ...session, phase: "armed" };
  tick();
});
$("cancelBtn").addEventListener("click", () => {
  store.del(ARMED_KEY);
  session = { phase: "idle", target: null, goAt: null, coming: {} };
  tick();
});
$("dismissBtn").addEventListener("click", () => {
  dismissedGoAt = session.goAt;
  render();
});

// ---------- Rendering ----------
function render() {
  const t = Date.now();
  const s = session;
  const target = s.target;
  $("route").textContent = `Bus ${CONFIG.routes.join(", ")} from ${CONFIG.stopName} (${CONFIG.stop}) to ${CONFIG.destination} · ${CONFIG.walkMin} min to pack up and walk`;
  $("boardTitle").textContent = `Buses to ${CONFIG.destination} from stop ${CONFIG.stop}`;

  $("armBtn").hidden = s.phase !== "idle";
  $("cancelBtn").hidden = s.phase === "idle";

  if (!fetchedAt && !fetchError) {
    // still loading; keep the placeholder sign
  } else if (!target) {
    $("signLabel").textContent = s.phase === "armed" ? "Alarm on · waiting for a bus you can catch" : "No bus you can catch yet";
    $("signBig").textContent = "--:--";
    $("signSub").textContent = buses.length
      ? `The next ${CONFIG.routes.join("/")} is too soon or too full. Waiting for a later one to show up.`
      : "No arrival times right now. They usually appear about 30 min ahead.";
  } else if (s.phase === "go") {
    $("signLabel").textContent = "Pack up now";
    $("signBig").textContent = mins(target.time - t);
    $("signSub").textContent = `until bus ${target.no} reaches the stop at ${clock(target.time)}`;
  } else {
    const packBy = target.time - leadMs;
    $("signLabel").textContent = s.phase === "armed" ? "Alarm on · pack up in" : "Next bus you can catch · pack up in";
    $("signBig").textContent = mmss(packBy - t);
    $("signSub").textContent = `Bus ${target.no} at ${clock(target.time)} · ${LOAD[target.load] || "Unknown space"} · pack up by ${clock(packBy)}`;
  }

  $("board").replaceChildren(...(buses.length ? buses.map((b) => {
    const tr = document.createElement("tr");
    const isTarget = target && b.no === target.no && b.time === target.time;
    let status = "Later";
    if (isTarget) status = s.phase === "go" ? "Leave now" : "Picked";
    else if (b.time - t < leadMs) status = "Too soon to reach";
    else if (b.load === "LSD") status = "Too full";
    tr.className = isTarget ? "picked" : status === "Later" ? "" : "out";
    tr.innerHTML = `<td class="svc"></td><td></td><td></td><td><span class="chip"></span></td><td class="status"></td>`;
    const td = tr.children;
    td[0].textContent = b.no;
    td[1].textContent = clock(b.time) + (b.live ? "" : " (scheduled)");
    td[2].textContent = mins(b.time - t);
    td[3].firstChild.className = `chip ${b.load}`;
    td[3].firstChild.textContent = LOAD[b.load] || b.load || "?";
    td[4].textContent = status;
    return tr;
  }) : [Object.assign(document.createElement("tr"), { innerHTML: '<td colspan="5">No buses to show right now.</td>' })]));

  $("fresh").textContent = fetchedAt ? `Times from arrivelah, updated ${Math.max(0, Math.round((t - fetchedAt) / 1000))}s ago.` : "";
  $("err").textContent = fetchError || "";

  renderAlarm(s, target, t);
}

let alarmTimer = null;
let notifiedGoAt = null;
function renderAlarm(s, target, t) {
  const ringing = s.phase === "go" && dismissedGoAt !== s.goAt;
  $("alarm").hidden = !ringing;
  if (ringing) {
    $("alarmSub").textContent = `Bus ${target.no} reaches the stop at ${clock(target.time)}, in ${mins(target.time - t)}.`;
    $("soundOff").hidden = !!audio && audio.state === "running";
    document.title = Math.floor(t / 1000) % 2 ? "🚌 PACK UP NOW" : "Lunch Bus";
    if (!alarmTimer) { chime(); alarmTimer = setInterval(chime, 1500); }
    if (notifiedGoAt !== s.goAt && "Notification" in window && Notification.permission === "granted") {
      notifiedGoAt = s.goAt;
      try { new Notification("Pack up now", { body: `Bus ${target.no} at ${clock(target.time)}. Lunch at ${CONFIG.destination}.`, requireInteraction: true }); } catch {}
    }
  } else {
    clearInterval(alarmTimer);
    alarmTimer = null;
    document.title = "Lunch Bus";
  }
}

render();
poll();
setInterval(poll, POLL_MS);
setInterval(tick, 1000);

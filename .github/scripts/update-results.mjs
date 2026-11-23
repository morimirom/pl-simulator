// Results robot for the PL 26/27 simulator.
// Reads finished games from the official Fantasy Premier League feed, cross-checks them
// against football-data.org (when FD_TOKEN is set), and rewrites the single `const D = ...;`
// line in index.html. Nothing else in the page is touched.
//
// Exit codes: 0 = done (changed or not), 1 = problem written to .robot/problem.md.
// A failed download is treated as "try again next run", not as a problem.
//
// Local testing: FPL_FILE / FD_FILE point at saved JSON instead of the network,
// NOW overrides the clock (ISO time), and INDEX_FILE overrides the page path.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const INDEX = process.env.INDEX_FILE || "index.html";
const OUT = ".robot";
fs.mkdirSync(OUT, { recursive: true });
const NOW = process.env.NOW ? new Date(process.env.NOW) : new Date();

// Our club names <- FPL short names / football-data.org three-letter codes.
const CODES = {
  "Arsenal": ["ARS"], "Man City": ["MCI"], "Brighton": ["BHA", "BRI"], "Chelsea": ["CHE"],
  "Everton": ["EVE"], "Liverpool": ["LIV"], "Brentford": ["BRE"], "Leeds": ["LEE"],
  "Bournemouth": ["BOU"], "Tottenham": ["TOT"], "Newcastle": ["NEW"], "Aston Villa": ["AVL"],
  "Hull City": ["HUL"], "Ipswich": ["IPS"], "Fulham": ["FUL"], "Nottm Forest": ["NFO", "NOT"],
  "Coventry": ["COV"], "Man Utd": ["MUN"], "Crystal Palace": ["CRY"], "Sunderland": ["SUN"],
};
// Name fallbacks (lower-case, punctuation removed) in case a code changes.
const NAMES = {
  "Arsenal": ["arsenal"], "Man City": ["man city", "manchester city"], "Brighton": ["brighton", "brighton hove albion"],
  "Chelsea": ["chelsea"], "Everton": ["everton"], "Liverpool": ["liverpool"], "Brentford": ["brentford"],
  "Leeds": ["leeds", "leeds united"], "Bournemouth": ["bournemouth", "afc bournemouth"], "Tottenham": ["spurs", "tottenham", "tottenham hotspur"],
  "Newcastle": ["newcastle", "newcastle united"], "Aston Villa": ["aston villa"], "Hull City": ["hull", "hull city"],
  "Ipswich": ["ipswich", "ipswich town"], "Fulham": ["fulham"], "Nottm Forest": ["nottm forest", "nottingham forest", "nott'm forest"],
  "Coventry": ["coventry", "coventry city"], "Man Utd": ["man utd", "manchester united"], "Crystal Palace": ["crystal palace"],
  "Sunderland": ["sunderland"],
};
const KO = {
  "Arsenal": "아스널", "Man City": "맨시티", "Brighton": "브라이턴", "Chelsea": "첼시", "Everton": "에버턴",
  "Liverpool": "리버풀", "Brentford": "브렌트퍼드", "Leeds": "리즈", "Bournemouth": "본머스", "Tottenham": "토트넘",
  "Newcastle": "뉴캐슬", "Aston Villa": "아스톤 빌라", "Hull City": "헐 시티", "Ipswich": "입스위치", "Fulham": "풀럼",
  "Nottm Forest": "노팅엄 포레스트", "Coventry": "코번트리", "Man Utd": "맨유", "Crystal Palace": "크리스털 팰리스",
  "Sunderland": "선덜랜드",
};
const norm = s => String(s || "").toLowerCase().replace(/\b(fc|afc)\b/g, " ").replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();

const problems = [];
const problem = msg => problems.push(msg);

function finish(changed, summary) {
  if (problems.length) {
    fs.writeFileSync(path.join(OUT, "problem.md"),
      "The results robot stopped without publishing. Nothing on the page was changed.\n\n" +
      problems.map(p => "- " + p).join("\n") +
      "\n\nIt will keep checking every 15 minutes and publish once everything agrees. " +
      "If this is a real correction (a score changed, a game was replayed or the new season's fixtures arrived), the data needs a manual update.\n");
    console.log("PROBLEM:\n" + problems.join("\n"));
    process.exit(1);
  }
  if (changed) fs.writeFileSync(path.join(OUT, "commit.txt"), summary);
  console.log(changed ? summary : "No new results.");
  process.exit(0);
}

async function getJSON(url, headers = {}, file) {
  if (file) return JSON.parse(fs.readFileSync(file, "utf8"));
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": "pl-simulator-results-robot", ...headers }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ---------- Read the data line ----------
const html = fs.readFileSync(INDEX, "utf8");
const lines = html.split("\n");
const li = lines.findIndex(l => l.startsWith("const D = "));
if (li < 0) { problem("Could not find the `const D = ...;` line in index.html."); finish(false); }
const D = JSON.parse(lines[li].slice("const D = ".length).replace(/;\s*$/, ""));
const TEAMS = D.teams, IDX = Object.fromEntries(TEAMS.map((t, i) => [t, i]));
const key = (h, a) => h + "-" + a;

function mapTeams(list, codeOf, nameOf, source) {
  const m = new Map();
  for (const t of list) {
    const code = codeOf(t), nm = norm(nameOf(t));
    let ours = Object.keys(CODES).find(k => CODES[k].includes(code));
    if (!ours) ours = Object.keys(NAMES).find(k => NAMES[k].includes(nm));
    if (ours && IDX[ours] !== undefined) m.set(t.id, IDX[ours]);
  }
  return m;
}

// ---------- FPL ----------
let fplTeams, fplFix;
try {
  const boot = await getJSON("https://fantasy.premierleague.com/api/bootstrap-static/", {}, process.env.FPL_BOOT_FILE);
  fplTeams = boot.teams;
  fplFix = await getJSON("https://fantasy.premierleague.com/api/fixtures/", {}, process.env.FPL_FILE);
} catch (e) {
  console.log("FPL feed not reachable this run (" + e.message + "). Will retry.");
  process.exit(0);
}
const fplMap = mapTeams(fplTeams, t => t.short_name, t => t.name, "FPL");
if (fplMap.size !== 20 || new Set(fplMap.values()).size !== 20) {
  const unknown = fplTeams.filter(t => !fplMap.has(t.id)).map(t => `${t.name} (${t.short_name})`);
  problem(`The FPL feed's clubs don't match this season's 20 clubs${unknown.length ? ": unknown " + unknown.join(", ") : ""}. ` +
    "If the new season's data has arrived, the page needs its yearly update.");
  finish(false);
}

const ourPlayed = new Map(D.played.map(g => [key(g[1], g[4]), g]));
const ourFuture = new Map(D.future.map(g => [key(g[1], g[2]), g]));
const newGames = [];
for (const f of fplFix) {
  if (!(f.finished || f.finished_provisional)) continue;
  if (f.team_h_score == null || f.team_a_score == null) continue;
  const h = fplMap.get(f.team_h), a = fplMap.get(f.team_a), k = key(h, a);
  const gh = f.team_h_score, ga = f.team_a_score;
  if (ourPlayed.has(k)) {
    const g = ourPlayed.get(k);
    if (g[2] !== gh || g[3] !== ga)
      problem(`${TEAMS[h]} v ${TEAMS[a]}: the page has ${g[2]}–${g[3]}, the FPL feed now says ${gh}–${ga}.`);
  } else if (ourFuture.has(k)) {
    newGames.push({ mw: ourFuture.get(k)[0], h, a, gh, ga, confirmed: !!f.finished });
  } else {
    problem(`${TEAMS[h]} v ${TEAMS[a]} (FPL fixture ${f.id}) is not in the fixture list.`);
  }
}

// ---------- football-data.org cross-check ----------
let fdChecked = 0, fdPending = 0;
if (process.env.FD_TOKEN || process.env.FD_FILE) {
  let fd = null;
  try {
    fd = await getJSON("https://api.football-data.org/v4/competitions/PL/matches", { "X-Auth-Token": process.env.FD_TOKEN || "" }, process.env.FD_FILE);
  } catch (e) { console.log("football-data.org not reachable this run (" + e.message + "). Using FPL only."); }
  if (fd && Array.isArray(fd.matches)) {
    const teams = new Map();
    for (const m of fd.matches) for (const t of [m.homeTeam, m.awayTeam]) if (t && t.id != null) teams.set(t.id, t);
    const fdMap = mapTeams([...teams.values()], t => t.tla, t => t.shortName || t.name, "football-data.org");
    if (fdMap.size !== 20) {
      console.log("football-data.org clubs did not map cleanly; skipping the cross-check this run.");
    } else {
      const fdRes = new Map();
      for (const m of fd.matches) {
        if (m.status !== "FINISHED" || !m.score || !m.score.fullTime || m.score.fullTime.home == null) continue;
        fdRes.set(key(fdMap.get(m.homeTeam.id), fdMap.get(m.awayTeam.id)), [m.score.fullTime.home, m.score.fullTime.away]);
      }
      const check = (h, a, gh, ga, where) => {
        const r = fdRes.get(key(h, a));
        if (!r) { fdPending++; return; }
        fdChecked++;
        if (r[0] !== gh || r[1] !== ga) problem(`${TEAMS[h]} v ${TEAMS[a]}: ${where} ${gh}–${ga}, football-data.org says ${r[0]}–${r[1]}.`);
      };
      for (const g of D.played) check(g[1], g[4], g[2], g[3], "the page has");
      for (const g of newGames) check(g.h, g.a, g.gh, g.ga, "FPL says");
    }
  }
}
if (problems.length) finish(false);
if (!newGames.length) finish(false);

// ---------- Apply ----------
const before = D.played.length;
const added = new Set(newGames.map(g => key(g.h, g.a)));
D.future = D.future.filter(g => !added.has(key(g[1], g[2])));
for (const g of newGames) D.played.push([g.mw, g.h, g.gh, g.ga, g.a]);
D.played.sort((x, y) => x[0] - y[0] || x[1] - y[1]);

// Checks: 380 games, every ordered pair once, each club 19 home + 19 away.
const all = [...D.played.map(g => key(g[1], g[4])), ...D.future.map(g => key(g[1], g[2]))];
if (all.length !== 380) problem(`After the update there would be ${all.length} games instead of 380.`);
if (new Set(all).size !== all.length) problem("After the update a (home, away) pair would appear twice.");
for (let i = 0; i < 20; i++) {
  const home = all.filter(k => k.split("-")[0] == i).length, away = all.filter(k => k.split("-")[1] == i).length;
  if (home !== 19 || away !== 19) problem(`${TEAMS[i]} would have ${home} home and ${away} away games.`);
}
if (problems.length) finish(false);

// ---------- asof and log ----------
const etParts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", day: "numeric", month: "short", year: "numeric",
  hour: "numeric", minute: "2-digit", hour12: true,
}).formatToParts(NOW).map(p => [p.type, p.value]));
D.asof = `${etParts.weekday} ${etParts.day} ${etParts.month} ${etParts.year}, ${etParts.hour}:${etParts.minute}${etParts.dayPeriod.toLowerCase()} ET`;
D.asof_iso = NOW.toISOString().replace(/\.\d+Z$/, "Z");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(NOW); // YYYY-MM-DD

function notes(games) {
  const mws = [...new Set(games.map(g => g[0]))].sort((a, b) => a - b);
  const en = games.map(g => `${TEAMS[g[1]]} ${g[2]}–${g[3]} ${TEAMS[g[4]]}`).join(", ");
  const ko = games.map(g => `${KO[TEAMS[g[1]]]} ${g[2]}–${g[3]} ${KO[TEAMS[g[4]]]}`).join(", ");
  const n = games.length;
  let noteEn = mws.length === 1
    ? `Added ${n} matchweek ${mws[0]} result${n > 1 ? "s" : ""}: ${en}.`
    : `Added ${n} results (matchweeks ${mws.join(", ")}): ${en}.`;
  let noteKo = mws.length === 1
    ? `${mws[0]}라운드 결과 ${n}경기 추가: ${ko}.`
    : `결과 ${n}경기 추가 (${mws.join(", ")}라운드): ${ko}.`;
  for (const m of mws) {
    if (D.played.filter(g => g[0] === m).length === 10) { noteEn += ` Matchweek ${m} complete.`; noteKo += ` ${m}라운드 완료.`; }
  }
  if (D.played.length === 380) { noteEn += " Season complete."; noteKo += " 시즌 종료."; }
  return { noteEn, noteKo };
}
const fresh = newGames.map(g => [g.mw, g.h, g.gh, g.ga, g.a]);
let entry = D.log.length && D.log[D.log.length - 1].date === today && Array.isArray(D.log[D.log.length - 1].games) ? D.log[D.log.length - 1] : null;
if (!entry) { entry = { date: today, note: "", note_ko: "", games: [] }; D.log.push(entry); }
entry.games = [...entry.games, ...fresh].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
const nn = notes(entry.games);
entry.note = nn.noteEn; entry.note_ko = nn.noteKo;

// ---------- Write back and syntax-check ----------
lines[li] = "const D = " + JSON.stringify(D) + ";";
const out = lines.join("\n");
const script = out.match(/<script>([\s\S]*?)<\/script>/);
const tmp = path.join(OUT, "check.js");
fs.writeFileSync(tmp, script ? script[1] : "");
const chk = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
if (!script || chk.status !== 0) { problem("The updated page script failed a syntax check: " + (chk.stderr || "no script found").trim()); finish(false); }
fs.writeFileSync(INDEX, out);

const list = newGames.map(g => `${TEAMS[g.h]} ${g.gh}–${g.ga} ${TEAMS[g.a]}${g.confirmed ? "" : " (provisional)"}`).join(", ");
finish(true,
  `Results ${today}\n\nAdded ${newGames.length}: ${list}.\n` +
  `${D.played.length} of 380 played (was ${before}). ` +
  (process.env.FD_TOKEN || process.env.FD_FILE ? `football-data.org: ${fdChecked} checked, ${fdPending} not there yet.` : "football-data.org cross-check off (no FD_TOKEN)."));

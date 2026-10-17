// Deterministic rota solver (docs/DOMAIN.md, "Solver contract").
//
// Pure and synchronous. Every input array is sorted by id first, so the same input gives
// byte-identical JSON output whatever the order of its arrays. There is no wall-clock limit: the
// search runs on fixed node budgets, so the answer never depends on machine speed.
//
// Objective, lexicographic:
//   1. covered shifts (max);
//   2. preference score (max): +1 per prefer matched, -1 per prefer_not matched (match = the shift's
//      start instant lies inside the window, see availability.ts);
//   3. fairness penalty (min), see FAIRNESS below;
//   4. tie-break: compare the rotas shift by shift in chronological order (start, then id) and prefer
//      the lower staff id; covering a shift beats leaving it uncovered.
//
// FAIRNESS. Three less-wanted categories: closes (label "Close"), weekend shifts (local start date
// Sat or Sun) and nights (label contains "night", or the shift runs past midnight). A shift can be in
// several (Sat Close = close + weekend). For each category c the pool P_c is the staff who hold the
// role of at least one category-c shift this week; load_i = history count (last 3 weeks) + category-c
// shifts this week. Penalty = sum over c of sum over i in P_c of (load_i - mean_c)^2, i.e. the spread
// of the unpopular work around its mean. The search compares it exactly as an integer
// (L * penalty, L = lcm of the pool sizes); the reported value is rounded to 3 decimals.
//
// Search. Pins are applied first and never moved. Phase 1 is an exact branch-and-bound for maximum
// coverage; phase 2 is a branch-and-bound over the max-coverage rotas for preference, then fairness,
// then the tie-break. Both branch on the undecided shift with the fewest feasible people (ties:
// chronological) and bound with "covered + undecided shifts someone can still take" and "preference +
// best remaining gain per shift". If a budget runs out, search.complete is false and the best rota
// found is kept; a final greedy pass then fills any uncovered shift someone could still take, so every
// remaining blocker is real.

import type { Assignment, Blocker, ResolvedConstraint, RulePack, Shift, SolveInput, SolveResult, StaffMember, StaffTotals, Uncovered } from "@/lib/domain/types";
import { weekdayOf } from "@/lib/domain/time";
import { effectiveCaps, findBlocker, isUnavailable, preferenceScore } from "./availability";
import { verifyRota } from "./check";

export const DEFAULT_NODE_BUDGETS = { coverage: 1_000_000, refine: 200_000 } as const;

export interface SolveOptions {
  /** Node budget for phase 1 (maximum coverage). */
  coverageNodeBudget?: number;
  /** Node budget for phase 2 (preference, fairness, tie-break). */
  refineNodeBudget?: number;
}

export const FAIRNESS_CATEGORIES = ["close", "weekend", "night"] as const;
export type FairnessCategory = (typeof FAIRNESS_CATEGORIES)[number];

/** The less-wanted categories a shift belongs to (feeds the fairness penalty). */
export function lessWantedCategories(shift: Shift): FairnessCategory[] {
  const out: FairnessCategory[] = [];
  if (shift.label.trim().toLowerCase() === "close") out.push("close");
  const wd = weekdayOf(shift.localDate);
  if (wd === "sat" || wd === "sun") out.push("weekend");
  const pastMidnight = shift.endLocal < shift.startLocal && shift.endLocal !== "00:00";
  if (/night/i.test(shift.label) || pastMidnight) out.push("night");
  return out;
}

const HOUR_MS = 3_600_000;
const UNDECIDED = -1;
const UNCOVERED = -2;

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Sort by id; exact duplicates of id fall back to their JSON so the order never depends on input order. */
function sortedBy<T>(xs: readonly T[], key: (x: T) => string): T[] {
  return [...xs].sort((a, b) => cmpStr(key(a), key(b)) || cmpStr(JSON.stringify(a), JSON.stringify(b)));
}
const round2 = (x: number) => Math.round(x * 100) / 100;
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

interface Model {
  zone: string;
  rulePack: RulePack;
  shifts: Shift[]; // chronological (start, then id); index = position
  staff: StaffMember[]; // by id
  constraintsOf: ResolvedConstraint[][]; // per staff index, sorted by id
  S: number;
  N: number;
  D: number;
  startMs: number[];
  endMs: number[];
  hc: number[]; // shift hours in centi-hours (integers)
  day: number[]; // local start date index
  hasRole: Uint8Array; // S*N
  eligible: Uint8Array; // S*N: role, availability, and the shift alone fits the caps
  gain: Int32Array; // S*N preference score
  conflicts: number[][]; // shifts that overlap or break minimum rest with shift s
  capH: number[]; // centi-hours
  capS: number[]; // Infinity = no cap
  minRestMs: number;
  maxPerDay: number;
  cats: number[][]; // category indices per shift
  inPool: Uint8Array; // C*N
  poolSize: number[];
  scale: number[]; // L / poolSize (0 for empty pools)
  L: number;
  baseLoad: number[]; // C*N history counts
  pinnedStaff: number[][]; // per shift, staff indices pinned to it (sorted)
}

function buildModel(input: SolveInput): Model {
  const zone = input.timezone;
  const staff = sortedBy(input.staff, (p) => p.id);
  const shifts = sortedBy(input.shifts, (s) => s.id).sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || cmpStr(a.id, b.id));
  const constraints = sortedBy(input.constraints, (c) => c.id);
  const S = shifts.length;
  const N = staff.length;
  const staffIndex = new Map(staff.map((p, i) => [p.id, i]));
  const shiftIndex = new Map(shifts.map((s, i) => [s.id, i]));

  const constraintsOf = staff.map((p) => constraints.filter((c) => c.staffId === p.id));
  const caps = staff.map((p, i) => effectiveCaps(p, constraintsOf[i], input.rulePack));
  const capH = caps.map((c) => Math.round(c.maxHours * 100));
  const capS = caps.map((c) => (c.maxShifts == null ? Infinity : c.maxShifts));

  const startMs = shifts.map((s) => Date.parse(s.start));
  const endMs = shifts.map((s) => Date.parse(s.end));
  const hc = shifts.map((s) => Math.round(s.hours * 100));
  const dates = [...new Set(shifts.map((s) => s.localDate))].sort();
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const day = shifts.map((s) => dateIndex.get(s.localDate)!);
  const minRestMs = Math.round(input.rulePack.minRestHours * HOUR_MS);
  const maxPerDay = input.rulePack.maxShiftsPerDay;

  const hasRole = new Uint8Array(S * N);
  const eligible = new Uint8Array(S * N);
  const gain = new Int32Array(S * N);
  for (let s = 0; s < S; s++) {
    for (let p = 0; p < N; p++) {
      const k = s * N + p;
      hasRole[k] = staff[p].roles.includes(shifts[s].role) ? 1 : 0;
      eligible[k] =
        hasRole[k] && hc[s] <= capH[p] && capS[p] >= 1 && maxPerDay >= 1 && !isUnavailable(staff[p].id, shifts[s], constraintsOf[p]) ? 1 : 0;
      gain[k] = preferenceScore(staff[p].id, shifts[s], constraintsOf[p]);
    }
  }

  const conflicts: number[][] = shifts.map(() => []);
  for (let a = 0; a < S; a++) {
    for (let b = a + 1; b < S; b++) {
      const overlap = startMs[a] < endMs[b] && startMs[b] < endMs[a];
      const gap = startMs[a] <= startMs[b] ? startMs[b] - endMs[a] : startMs[a] - endMs[b];
      if (overlap || gap < minRestMs) {
        conflicts[a].push(b);
        conflicts[b].push(a);
      }
    }
  }

  const C = FAIRNESS_CATEGORIES.length;
  const cats = shifts.map((s) => lessWantedCategories(s).map((c) => FAIRNESS_CATEGORIES.indexOf(c)));
  const inPool = new Uint8Array(C * N);
  for (let s = 0; s < S; s++) for (const c of cats[s]) for (let p = 0; p < N; p++) if (hasRole[s * N + p]) inPool[c * N + p] = 1;
  const poolSize = FAIRNESS_CATEGORIES.map((_, c) => {
    let n = 0;
    for (let p = 0; p < N; p++) n += inPool[c * N + p];
    return n;
  });
  const L = poolSize.reduce((acc, n) => (n > 0 ? (acc * n) / gcd(acc, n) : acc), 1);
  const scale = poolSize.map((n) => (n > 0 ? L / n : 0));
  const baseLoad = new Array<number>(C * N).fill(0);
  for (const h of sortedBy(input.history, (h) => h.staffId)) {
    const p = staffIndex.get(h.staffId);
    if (p === undefined) continue;
    const counts = [h.closes, h.weekends, h.nights];
    for (let c = 0; c < C; c++) if (inPool[c * N + p]) baseLoad[c * N + p] += counts[c] ?? 0;
  }

  // Pins referring to an unknown shift or person cannot be placed and are ignored; every other pin
  // is kept even if it breaks a rule (the checker then reports it).
  const pinnedStaff: number[][] = shifts.map(() => []);
  for (const pin of sortedBy(input.pins, (x) => `${x.shiftId}\u0000${x.staffId}`)) {
    const s = shiftIndex.get(pin.shiftId);
    const p = staffIndex.get(pin.staffId);
    if (s === undefined || p === undefined || pinnedStaff[s].includes(p)) continue;
    pinnedStaff[s].push(p);
  }

  return {
    zone, rulePack: input.rulePack, shifts, staff, constraintsOf, S, N, D: dates.length, startMs, endMs, hc, day, hasRole, eligible, gain, conflicts,
    capH, capS, minRestMs, maxPerDay, cats, inPool, poolSize, scale, L, baseLoad, pinnedStaff,
  };
}

/** Mutable search state: per-person resources plus the running objective terms. */
class State {
  readonly assignee: Int32Array; // UNDECIDED, UNCOVERED or a staff index (first pinned person for pinned shifts)
  readonly usedH: number[];
  readonly usedS: number[];
  readonly dayCount: Int32Array; // N*D
  readonly conflCount: Int32Array; // N*S: how many of p's shifts conflict with shift s
  covered = 0;
  pref = 0;
  readonly load: number[]; // C*N
  readonly sum: number[];
  readonly sumsq: number[];

  constructor(private readonly m: Model) {
    this.assignee = new Int32Array(m.S).fill(UNDECIDED);
    this.usedH = new Array<number>(m.N).fill(0);
    this.usedS = new Array<number>(m.N).fill(0);
    this.dayCount = new Int32Array(m.N * m.D);
    this.conflCount = new Int32Array(m.N * m.S);
    this.load = [...m.baseLoad];
    this.sum = FAIRNESS_CATEGORIES.map(() => 0);
    this.sumsq = FAIRNESS_CATEGORIES.map(() => 0);
    for (let c = 0; c < FAIRNESS_CATEGORIES.length; c++) {
      for (let p = 0; p < m.N; p++) {
        if (!m.inPool[c * m.N + p]) continue;
        const x = this.load[c * m.N + p];
        this.sum[c] += x;
        this.sumsq[c] += x * x;
      }
    }
  }

  feasible(s: number, p: number): boolean {
    const m = this.m;
    return (
      m.eligible[s * m.N + p] === 1 &&
      this.conflCount[p * m.S + s] === 0 &&
      this.dayCount[p * m.D + m.day[s]] < m.maxPerDay &&
      this.usedH[p] + m.hc[s] <= m.capH[p] &&
      this.usedS[p] + 1 <= m.capS[p]
    );
  }

  /** Give shift s to person p (resources and objective only; the caller manages assignee/covered). */
  add(s: number, p: number): void {
    const m = this.m;
    this.usedH[p] += m.hc[s];
    this.usedS[p] += 1;
    this.dayCount[p * m.D + m.day[s]] += 1;
    for (const t of m.conflicts[s]) this.conflCount[p * m.S + t] += 1;
    this.pref += m.gain[s * m.N + p];
    for (const c of m.cats[s]) {
      const k = c * m.N + p;
      if (!m.inPool[k]) continue;
      const x = this.load[k];
      this.sumsq[c] += 2 * x + 1;
      this.sum[c] += 1;
      this.load[k] = x + 1;
    }
  }

  remove(s: number, p: number): void {
    const m = this.m;
    this.usedH[p] -= m.hc[s];
    this.usedS[p] -= 1;
    this.dayCount[p * m.D + m.day[s]] -= 1;
    for (const t of m.conflicts[s]) this.conflCount[p * m.S + t] -= 1;
    this.pref -= m.gain[s * m.N + p];
    for (const c of m.cats[s]) {
      const k = c * m.N + p;
      if (!m.inPool[k]) continue;
      const x = this.load[k] - 1;
      this.load[k] = x;
      this.sum[c] -= 1;
      this.sumsq[c] -= 2 * x + 1;
    }
  }

  /** L * fairness penalty, an exact integer. */
  fairness(): number {
    const m = this.m;
    let total = 0;
    for (let c = 0; c < FAIRNESS_CATEGORIES.length; c++) {
      if (m.poolSize[c] === 0) continue;
      total += m.scale[c] * (m.poolSize[c] * this.sumsq[c] - this.sum[c] * this.sum[c]);
    }
    return total;
  }

  /** Change in fairness() if p took shift s (used only to order candidates). */
  fairnessDelta(s: number, p: number): number {
    const m = this.m;
    let delta = 0;
    for (const c of m.cats[s]) {
      const k = c * m.N + p;
      if (!m.inPool[k]) continue;
      delta += m.scale[c] * (m.poolSize[c] * (2 * this.load[k] + 1) - (2 * this.sum[c] + 1));
    }
    return delta;
  }

  applyPins(): void {
    const m = this.m;
    for (let s = 0; s < m.S; s++) {
      const pinned = m.pinnedStaff[s];
      if (pinned.length === 0) continue;
      for (const p of pinned) this.add(s, p);
      this.assignee[s] = pinned[0];
      this.covered += 1;
    }
  }

  assign(s: number, p: number): void {
    this.add(s, p);
    this.assignee[s] = p;
    this.covered += 1;
  }

  unassign(s: number, p: number): void {
    this.remove(s, p);
    this.assignee[s] = UNDECIDED;
    this.covered -= 1;
  }
}

interface Scan {
  pick: number; // undecided shift to branch on, -1 if none
  covBound: number;
  prefBound: number;
}

/** One pass over the undecided shifts: branching choice (fewest feasible people) and both bounds. */
function scan(m: Model, st: State): Scan {
  let pick = -1;
  let pickCount = Infinity;
  let covBound = st.covered;
  let prefBound = st.pref;
  for (let s = 0; s < m.S; s++) {
    if (st.assignee[s] !== UNDECIDED) continue;
    let count = 0;
    let best = 0; // leaving it uncovered scores 0, so the bound never needs less than 0
    for (let p = 0; p < m.N; p++) {
      if (!st.feasible(s, p)) continue;
      count++;
      const g = m.gain[s * m.N + p];
      if (g > best) best = g;
    }
    if (count > 0) {
      covBound++;
      prefBound += best;
    }
    if (count < pickCount) {
      pick = s;
      pickCount = count;
    }
  }
  return { pick, covBound, prefBound };
}

/** Feasible people for shift s, best first: preference gain, then fairness, then staff id. */
function candidates(m: Model, st: State, s: number): number[] {
  const list: { p: number; g: number; f: number }[] = [];
  for (let p = 0; p < m.N; p++) if (st.feasible(s, p)) list.push({ p, g: m.gain[s * m.N + p], f: st.fairnessDelta(s, p) });
  list.sort((a, b) => b.g - a.g || a.f - b.f || a.p - b.p);
  return list.map((x) => x.p);
}

interface Incumbent {
  cov: number;
  pref: number;
  fair: number;
  vec: Int32Array; // copy of State.assignee
}

/** Rota order for the final tie-break: chronological shifts, lower staff index first, uncovered last. */
function lexLess(a: Int32Array, b: Int32Array, N: number): boolean {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] < 0 ? N : a[i];
    const y = b[i] < 0 ? N : b[i];
    if (x !== y) return x < y;
  }
  return false;
}

function better(st: State, inc: Incumbent, N: number): boolean {
  if (st.covered !== inc.cov) return st.covered > inc.cov;
  if (st.pref !== inc.pref) return st.pref > inc.pref;
  const f = st.fairness();
  if (f !== inc.fair) return f < inc.fair;
  return lexLess(st.assignee, inc.vec, N);
}

function snapshot(st: State): Incumbent {
  return { cov: st.covered, pref: st.pref, fair: st.fairness(), vec: st.assignee.slice() };
}

/** Phase 1: exact maximum coverage. */
function maxCoverage(m: Model, budget: number) {
  const st = new State(m);
  st.applyPins();
  let best: Int32Array | null = null;
  let bestCov = -1;
  let rootBound = -1;
  let nodes = 0;
  let aborted = false;

  const dfs = (): void => {
    if (nodes >= budget) {
      aborted = true;
      return;
    }
    nodes++;
    const { pick, covBound } = scan(m, st);
    if (pick === -1) {
      if (st.covered > bestCov) {
        bestCov = st.covered;
        best = st.assignee.slice();
      }
      return;
    }
    if (rootBound < 0) rootBound = covBound;
    if (covBound <= bestCov) return;
    for (const p of candidates(m, st, pick)) {
      st.assign(pick, p);
      dfs();
      st.unassign(pick, p);
      if (aborted || bestCov >= rootBound) return;
    }
    st.assignee[pick] = UNCOVERED;
    dfs();
    st.assignee[pick] = UNDECIDED;
  };
  dfs();
  return { best: best as Int32Array | null, nodes, complete: !aborted };
}

/** Phase 2: best preference, then fairness, then tie-break, among rotas at least as covered as `start`. */
function refine(m: Model, start: Incumbent, budget: number) {
  const st = new State(m);
  st.applyPins();
  let inc = start;
  let nodes = 0;
  let aborted = false;

  const dfs = (): void => {
    if (nodes >= budget) {
      aborted = true;
      return;
    }
    nodes++;
    const { pick, covBound, prefBound } = scan(m, st);
    if (pick === -1) {
      if (better(st, inc, m.N)) inc = snapshot(st);
      return;
    }
    if (covBound < inc.cov || (covBound === inc.cov && prefBound < inc.pref)) return;
    for (const p of candidates(m, st, pick)) {
      st.assign(pick, p);
      dfs();
      st.unassign(pick, p);
      if (aborted) return;
    }
    st.assignee[pick] = UNCOVERED;
    dfs();
    st.assignee[pick] = UNDECIDED;
  };
  dfs();
  return { inc, nodes, complete: !aborted };
}

/** A State holding the pins plus the non-pinned choices of `vec`. */
function replay(m: Model, vec: Int32Array | null): State {
  const st = new State(m);
  st.applyPins();
  for (let s = 0; s < m.S; s++) {
    if (m.pinnedStaff[s].length > 0) continue;
    const p = vec ? vec[s] : UNCOVERED;
    if (p >= 0) st.assign(s, p);
    else st.assignee[s] = UNCOVERED;
  }
  return st;
}

/** Give every uncovered shift to the first person who can still take it (no-op after a complete search). */
function greedyFill(m: Model, st: State): void {
  for (let s = 0; s < m.S; s++) {
    if (st.assignee[s] >= 0) continue;
    for (let p = 0; p < m.N; p++) {
      if (st.feasible(s, p)) {
        st.assign(s, p);
        break;
      }
    }
    if (st.assignee[s] < 0) st.assignee[s] = UNCOVERED;
  }
}

export function solve(input: SolveInput, options: SolveOptions = {}): SolveResult {
  const m = buildModel(input);
  const coverageBudget = options.coverageNodeBudget ?? DEFAULT_NODE_BUDGETS.coverage;
  const refineBudget = options.refineNodeBudget ?? DEFAULT_NODE_BUDGETS.refine;

  const phase1 = maxCoverage(m, coverageBudget);
  const seed = replay(m, phase1.best);
  greedyFill(m, seed); // only matters if phase 1 stopped before reaching any complete rota
  const phase2 = refine(m, snapshot(seed), refineBudget);
  const st = replay(m, phase2.inc.vec);
  greedyFill(m, st);

  const { shifts, staff } = m;
  const byPerson: number[][] = staff.map(() => []);
  const assignments: Assignment[] = [];
  for (let s = 0; s < m.S; s++) {
    const pinned = m.pinnedStaff[s];
    if (pinned.length > 0) {
      for (const p of pinned) {
        assignments.push({ shiftId: shifts[s].id, staffId: staff[p].id, pinned: true });
        byPerson[p].push(s);
      }
    } else if (st.assignee[s] >= 0) {
      assignments.push({ shiftId: shifts[s].id, staffId: staff[st.assignee[s]].id, pinned: false });
      byPerson[st.assignee[s]].push(s);
    }
  }

  const uncovered: Uncovered[] = [];
  for (let s = 0; s < m.S; s++) {
    if (st.assignee[s] >= 0) continue;
    const blockers: Blocker[] = [];
    let withoutRole = 0;
    for (let p = 0; p < m.N; p++) {
      if (!m.hasRole[s * m.N + p]) {
        withoutRole++;
        continue;
      }
      const theirs = byPerson[p].map((t) => shifts[t]);
      const blocker = findBlocker(staff[p], shifts[s], theirs, m.constraintsOf[p], m.rulePack, m.zone);
      // Unreachable: greedyFill gives a shift to anyone who could still take it.
      if (!blocker) throw new Error(`solver invariant broken: ${staff[p].id} could take ${shifts[s].id}`);
      blockers.push(blocker);
    }
    uncovered.push({ shiftId: shifts[s].id, role: shifts[s].role, blockers, withoutRole });
  }

  const totals: StaffTotals[] = staff.map((person, p) => {
    const mine = byPerson[p]; // chronological
    let minRest: number | null = null;
    for (let i = 1; i < mine.length; i++) {
      const gap = round2((m.startMs[mine[i]] - m.endMs[mine[i - 1]]) / HOUR_MS);
      if (minRest === null || gap < minRest) minRest = gap;
    }
    return {
      staffId: person.id,
      hours: round2(mine.reduce((sum, s) => sum + m.hc[s], 0) / 100),
      shifts: mine.length,
      minRestHours: minRest,
    };
  });

  return {
    assignments,
    uncovered,
    coverage: { covered: st.covered, total: m.S },
    totals,
    violations: verifyRota(input, assignments),
    objective: { covered: st.covered, preferenceScore: st.pref, fairnessPenalty: Math.round((st.fairness() / m.L) * 1000) / 1000 },
    search: { nodes: phase1.nodes + phase2.nodes, complete: phase1.complete && phase2.complete },
  };
}

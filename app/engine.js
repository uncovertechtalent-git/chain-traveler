// Chain Traveler routing engine: connection scan over a compact GTFS timetable.
// Runs in the browser and in Node (no DOM). Times are minutes; day 0 is meta.firstDate.

const INF = 1 << 30;
const LAYERS = [-1, 0, 1, 2];            // service days relative to the query day that can matter
const OFFS = LAYERS.map(l => l * 1440);

const enc = (ci, layer) => ci * 4 + layer;
const decCi = e => e >> 2;
const decLayer = e => e & 3;

// Two spellings so "München", "Muenchen", and "Munchen" all find the same station.
const tidy = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export function norm(s) {          // umlauts expanded: ü -> ue
  return tidy(s.toLowerCase().replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue'));
}
export function normPlain(s) {     // umlauts dropped: ü -> u
  return tidy(s.toLowerCase().replace(/ß/g, 'ss'));
}

export class Timetable {
  constructor(meta, buf) {
    this.meta = meta;
    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'CHT1') throw new Error('bad timetable file');
    const n = this.nStations = dv.getUint32(4, true);
    const c = this.nConn = dv.getUint32(8, true);
    const t = this.nTrips = dv.getUint32(12, true);
    const f = this.nFoot = dv.getUint32(16, true);
    this.firstDate = dv.getUint32(20, true);
    this.nDays = dv.getUint32(24, true);
    let off = 32;
    const take = (Type, len) => {
      const a = new Type(buf, off, len);
      off += len * Type.BYTES_PER_ELEMENT;
      off = (off + 3) & ~3;
      return a;
    };
    this.connFrom = take(Uint16Array, c);
    this.connTo = take(Uint16Array, c);
    this.connDep = take(Uint16Array, c);
    this.connArr = take(Uint16Array, c);
    this.connTrip = take(Uint32Array, c);
    this.connFlags = take(Uint8Array, c);
    this.tripSvc = take(Uint32Array, t);
    this.tripLine = take(Uint16Array, t);
    this.tripTerm = take(Uint16Array, t);
    const fa = take(Uint16Array, f), fb = take(Uint16Array, f), fm = take(Uint8Array, f);
    this.names = meta.stations;
    this.lat = meta.lat;
    this.lon = meta.lon;
    this.lines = meta.lines;

    // departures per station, in time order (connections are globally sorted by departure)
    this.stStart = new Uint32Array(n + 1);
    for (let i = 0; i < c; i++) this.stStart[this.connFrom[i] + 1]++;
    for (let i = 0; i < n; i++) this.stStart[i + 1] += this.stStart[i];
    const fill = this.stStart.slice(0, n);
    this.stConn = new Uint32Array(c);
    for (let i = 0; i < c; i++) this.stConn[fill[this.connFrom[i]]++] = i;

    // footpaths per station
    this.fpStart = new Uint32Array(n + 1);
    for (let i = 0; i < f; i++) this.fpStart[fa[i] + 1]++;
    for (let i = 0; i < n; i++) this.fpStart[i + 1] += this.fpStart[i];
    const ff = this.fpStart.slice(0, n);
    this.fpTo = new Uint16Array(f);
    this.fpMin = new Uint8Array(f);
    for (let i = 0; i < f; i++) { const k = ff[fa[i]]++; this.fpTo[k] = fb[i]; this.fpMin[k] = fm[i]; }

    this.degree = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.degree[i] = this.stStart[i + 1] - this.stStart[i];
    this.normNames = this.names.map(norm);
    this.plainNames = this.names.map(normPlain);
  }

  // ---- dates ----
  dateOf(dayIdx) {
    const s = String(this.firstDate);
    const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + dayIdx));
    return d.toISOString().slice(0, 10);
  }
  dayIndex(isoDate) {
    const s = String(this.firstDate);
    const a = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
    const [y, m, d] = isoDate.split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - a) / 86400000);
  }

  // ---- station search ----
  search(q, limit = 8) {
    const forms = [[norm(q), this.normNames], [normPlain(q), this.plainNames]];
    if (!forms[0][0]) return [];
    const out = [];
    for (let i = 0; i < this.nStations; i++) {
      let score = 0;
      for (const [nq, names] of forms) {
        const nn = names[i];
        const toks = nq.split(' ');
        let s = 0;
        if (nn === nq) s = 1000;
        else if (nn.startsWith(nq)) s = 600;
        else if (toks.every(tk => nn.split(' ').some(w => w.startsWith(tk)))) s = 400;
        else if (toks.every(tk => nn.includes(tk))) s = 200;
        if (s > score) score = s;
      }
      if (!score) continue;
      score += Math.min(150, Math.log2(1 + this.degree[i]) * 12) - this.names[i].length * 0.4;
      out.push([score, i]);
    }
    out.sort((a, b) => b[0] - a[0]);
    return out.slice(0, limit).map(x => x[1]);
  }
  find(name) {
    const nn = norm(name);
    let best = -1;
    for (let i = 0; i < this.nStations; i++) if (this.normNames[i] === nn && (best < 0 || this.degree[i] > this.degree[best])) best = i;
    return best;
  }

  // The stations nearest to a position in degrees, nearest first, as { station, km } (great-circle). Only stations a
  // train leaves from; none farther than maxKm. Bad input gives an empty list.
  nearby({ lat, lon, limit = 4, maxKm = 40 }) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
    const rad = Math.PI / 180, cosLat = Math.cos(lat * rad), out = [];
    for (let s = 0; s < this.nStations; s++) {
      if (!this.degree[s]) continue;
      const a = Math.sin((this.lat[s] - lat) * rad / 2) ** 2 + cosLat * Math.cos(this.lat[s] * rad) * Math.sin((this.lon[s] - lon) * rad / 2) ** 2;
      const km = 12742 * Math.asin(Math.sqrt(a));
      if (km <= maxKm) out.push({ station: s, km });
    }
    return out.sort((x, y) => x.km - y.km).slice(0, limit);
  }

  // A trip runs once per service day; a cancellation hits one run. Runs are keyed by service day and trip number.
  tripKey(svcDay, trip) { return svcDay * this.nTrips + trip; }

  // ---- earliest arrival (connection scan) ----
  // opts: { day, src, t0, minTransfer, target, exclude }  t0 in minutes after midnight of `day` (may exceed 1440).
  // exclude: a Set of tripKey() values, runs that do not happen (a cancelled train). The scan never boards them.
  earliestArrival({ day, src, t0, minTransfer = 4, target = -1, exclude = null }) {
    const n = this.nStations, nT = this.nTrips;
    const arr = new Int32Array(n).fill(INF);
    const inC = new Int32Array(n).fill(-1);
    const footFrom = new Int32Array(n).fill(-1);
    const tripBoard = new Int32Array(LAYERS.length * nT).fill(-1);
    arr[src] = t0;
    const relaxFoot = (s, t) => {
      for (let k = this.fpStart[s]; k < this.fpStart[s + 1]; k++) {
        const to = this.fpTo[k], nt = t + this.fpMin[k];
        if (nt < arr[to]) { arr[to] = nt; footFrom[to] = s; inC[to] = -1; }
      }
    };
    relaxFoot(src, t0);

    const days = LAYERS.map(l => day + l);
    const p = LAYERS.map((l, k) => {
      if (days[k] < 0 || days[k] >= this.nDays) return this.nConn;
      return lowerBound(this.connDep, t0 - OFFS[k]);
    });
    const { connFrom, connTo, connDep, connArr, connTrip, connFlags, tripSvc } = this;
    for (;;) {
      let best = -1, bt = INF;
      for (let k = 0; k < LAYERS.length; k++) {
        if (p[k] < this.nConn) { const tt = connDep[p[k]] + OFFS[k]; if (tt < bt) { bt = tt; best = k; } }
      }
      if (best < 0) break;
      if (target >= 0 && bt >= arr[target]) break;
      const ci = p[best]++;
      const trip = connTrip[ci];
      if (!((tripSvc[trip] >>> days[best]) & 1)) continue;
      if (exclude && exclude.has(days[best] * nT + trip)) continue;
      const key = best * nT + trip;
      let on = tripBoard[key] >= 0;
      const f = connFrom[ci];
      if (!on && (connFlags[ci] & 1)) {
        const a = arr[f];
        if (a < INF) {
          const need = f === src ? 0 : (footFrom[f] >= 0 ? 0 : minTransfer);
          if (a + need <= bt) { tripBoard[key] = enc(ci, best); on = true; }
        }
      }
      if (on && (connFlags[ci] & 2)) {
        const t = connArr[ci] + OFFS[best], to = connTo[ci];
        if (t < arr[to]) { arr[to] = t; inC[to] = enc(ci, best); footFrom[to] = -1; relaxFoot(to, t); }
      }
    }
    return { arr, inC, footFrom, tripBoard, src, day, t0 };
  }

  legsTo(res, dst) {
    const legs = [];
    let s = dst, guard = 0;
    while (s !== res.src && guard++ < 400) {
      if (res.footFrom[s] >= 0) {
        const from = res.footFrom[s];
        legs.push({ walk: true, from, to: s, dep: res.arr[from], arr: res.arr[s] });
        s = from;
        continue;
      }
      const e = res.inC[s];
      if (e < 0) return null;
      const ci = decCi(e), layer = decLayer(e), trip = this.connTrip[ci];
      const b = res.tripBoard[layer * this.nTrips + trip];
      const bci = decCi(b);
      legs.push({
        walk: false, trip, svcDay: res.day + LAYERS[layer], line: this.lines[this.tripLine[trip]], term: this.tripTerm[trip],
        from: this.connFrom[bci], to: this.connTo[ci],
        dep: this.connDep[bci] + OFFS[layer], arr: this.connArr[ci] + OFFS[layer],
      });
      s = this.connFrom[bci];
    }
    return legs.reverse();
  }

  // Plan src -> dst, optionally with a stop-over of at least stayMin minutes at `via`.
  plan({ day, src, dst, t0, via = -1, stayMin = 180, minTransfer = 4 }) {
    if (src === dst) return { error: 'Start and target are the same station.' };
    if (via >= 0 && via !== src && via !== dst) {
      const r1 = this.earliestArrival({ day, src, t0, minTransfer, target: via });
      if (r1.arr[via] >= INF) return { error: 'The stop-over cannot be reached after the start time.' };
      const tv = r1.arr[via];
      const r2 = this.earliestArrival({ day, src: via, t0: tv + stayMin, minTransfer, target: dst });
      if (r2.arr[dst] >= INF) return { error: 'No onward connection after the stay; try a shorter stay or an earlier start.' };
      const legs1 = this.legsTo(r1, via), legs2 = this.legsTo(r2, dst);
      return { legs: [...legs1, ...legs2], stays: [{ station: via, arr: tv, dep: legs2[0].dep }], reach: r1 };
    }
    const r = this.earliestArrival({ day, src, t0, minTransfer, target: dst });
    if (r.arr[dst] >= INF) return { error: 'No connection that day after the start time.' };
    return { legs: this.legsTo(r, dst), stays: [], reach: r };
  }

  // Next boardable departures from a station at or after absolute time t (minutes after midnight of `day`).
  departures({ day, station, t, limit = 6 }) {
    const out = [];
    const lo = this.stStart[station], hi = this.stStart[station + 1];
    for (let k = 0; k < LAYERS.length; k++) {
      const d = day + LAYERS[k];
      if (d < 0 || d >= this.nDays) continue;
      let i = lowerBoundIdx(this.stConn, this.connDep, lo, hi, t - OFFS[k]);
      let found = 0;
      for (; i < hi && found < limit; i++) {
        const ci = this.stConn[i], trip = this.connTrip[ci];
        if (!((this.tripSvc[trip] >>> d) & 1) || !(this.connFlags[ci] & 1)) continue;
        out.push({ dep: this.connDep[ci] + OFFS[k], arr: this.connArr[ci] + OFFS[k], next: this.connTo[ci],
          line: this.lines[this.tripLine[trip]], term: this.tripTerm[trip], trip, svcDay: d });
        found++;
      }
    }
    out.sort((a, b) => a.dep - b.dep);
    return out.slice(0, limit);
  }

  // The connection that follows each connection on the same trip, or -1 at the end of the trip. Built on first use.
  get nextOnTrip() {
    if (!this._nextOnTrip) {
      const next = new Int32Array(this.nConn).fill(-1);
      const last = new Int32Array(this.nTrips).fill(-1);
      for (let ci = 0; ci < this.nConn; ci++) {
        const t = this.connTrip[ci];
        if (last[t] >= 0) next[last[t]] = ci;
        last[t] = ci;
      }
      this._nextOnTrip = next;
    }
    return this._nextOnTrip;
  }

  // The time the trip of connection `ci` arrives at `station`, riding on from the departure of `ci`, or -1 if it never
  // calls there (or does not let you alight there).
  callsAt(ci, station) {
    const next = this.nextOnTrip;
    for (let c = ci; c >= 0; c = next[c]) {
      if (this.connTo[c] === station && (this.connFlags[c] & 2)) return this.connArr[c];
    }
    return -1;
  }

  // Trains that serve the link from -> to: runs boardable at `from` between t - before and t + after (minutes after
  // midnight of `day`) that call at `to` further on. With a 60 minute window this is "trains an hour".
  callsPerWindow({ day, from, to, t, before = 30, after = 30, exclude = null }) {
    const lo = this.stStart[from], hi = this.stStart[from + 1];
    let n = 0;
    for (let k = 0; k < LAYERS.length; k++) {
      const d = day + LAYERS[k];
      if (d < 0 || d >= this.nDays) continue;
      const end = t + after - OFFS[k];
      for (let i = lowerBoundIdx(this.stConn, this.connDep, lo, hi, t - before - OFFS[k]); i < hi; i++) {
        const ci = this.stConn[i];
        if (this.connDep[ci] >= end) break;
        const trip = this.connTrip[ci];
        if (!((this.tripSvc[trip] >>> d) & 1) || !(this.connFlags[ci] & 1)) continue;
        if (exclude && exclude.has(d * this.nTrips + trip)) continue;
        if (this.callsAt(ci, to) >= 0) n++;
      }
    }
    return n;
  }
}

function lowerBound(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
  return lo;
}
function lowerBoundIdx(index, depArr, lo, hi, v) {
  while (lo < hi) { const mid = (lo + hi) >> 1; if (depArr[index[mid]] < v) lo = mid + 1; else hi = mid; }
  return lo;
}

export const fmt = m => {
  const nd = Math.floor(m / 1440);
  const x = ((m % 1440) + 1440) % 1440;
  return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0') + (nd > 0 ? '+' + nd : nd < 0 ? String(nd) : '');
};
export const dur = m => (m >= 60 ? Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min' : m + ' min');
export { INF };

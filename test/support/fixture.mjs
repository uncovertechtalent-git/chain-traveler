// A tiny timetable in the CHT1 binary format, built in memory, so the engine can be tested without the feed.
// Format (little endian): "CHT1", nStations, nConn, nTrips, nFoot, firstDate (yyyymmdd), nDays, 4 spare bytes,
// then connFrom, connTo, connDep, connArr (u16 each), connTrip (u32), connFlags (u8), tripSvc (u32 day mask),
// tripLine (u16), tripTerm (u16), footFrom, footTo (u16), footMin (u8); every section padded to 4 bytes.
// Connection flags: 1 = may board at `from`, 2 = may alight at `to`.

const pad4 = n => (n + 3) & ~3;

export function buildFixture({ stations, lines, trips, foot = [], firstDate = 20261101, nDays = 7 }) {
  const conns = [];
  trips.forEach((trip, ti) => {
    for (let i = 0; i + 1 < trip.stops.length; i++) {
      const a = trip.stops[i], b = trip.stops[i + 1];
      conns.push({ from: a.st, to: b.st, dep: a.dep, arr: b.arr, trip: ti, flags: (a.board === false ? 0 : 1) | (b.alight === false ? 0 : 2) });
    }
  });
  conns.sort((x, y) => x.dep - y.dep || x.arr - y.arr || x.trip - y.trip);

  const sections = [
    Uint16Array.from(conns.map(c => c.from)),
    Uint16Array.from(conns.map(c => c.to)),
    Uint16Array.from(conns.map(c => c.dep)),
    Uint16Array.from(conns.map(c => c.arr)),
    Uint32Array.from(conns.map(c => c.trip)),
    Uint8Array.from(conns.map(c => c.flags)),
    Uint32Array.from(trips.map(t => t.svc >>> 0)),
    Uint16Array.from(trips.map(t => t.line)),
    Uint16Array.from(trips.map(t => t.term)),
    Uint16Array.from(foot.map(f => f[0])),
    Uint16Array.from(foot.map(f => f[1])),
    Uint8Array.from(foot.map(f => f[2])),
  ];
  let size = 32;
  for (const s of sections) size += pad4(s.byteLength);
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  'CHT1'.split('').forEach((ch, i) => dv.setUint8(i, ch.charCodeAt(0)));
  [stations.length, conns.length, trips.length, foot.length, firstDate, nDays].forEach((v, i) => dv.setUint32(4 + 4 * i, v, true));
  let off = 32;
  for (const s of sections) {
    new Uint8Array(buf, off, s.byteLength).set(new Uint8Array(s.buffer, s.byteOffset, s.byteLength));
    off += pad4(s.byteLength);
  }
  const iso = `${String(firstDate).slice(0, 4)}-${String(firstDate).slice(4, 6)}-${String(firstDate).slice(6, 8)}`;
  const meta = {
    format: 1, firstDate: iso, nDays,
    counts: { stations: stations.length, connections: conns.length, trips: trips.length, footpaths: foot.length },
    feed: { source: 'fixture', publisher: 'fixture', license: 'fixture', sha256: null, built: '2026-11-01T00:00:00Z' },
    stations: stations.map(s => s.name), lat: stations.map(s => s.lat), lon: stations.map(s => s.lon), lines,
  };
  return { meta, buf };
}

export const hm = s => +s.slice(0, 2) * 60 + +s.slice(3, 5);

// Six stations, eight trips, one footpath. Day 0 is Sunday 2026-11-01; svc is a bit mask of days from day 0.
export function sampleNetwork() {
  const stations = [
    { name: 'Alpha Hbf', lat: 52.0, lon: 10.0 },    // 0
    { name: 'Beta Hbf', lat: 51.5, lon: 10.5 },     // 1
    { name: 'Gamma Hbf', lat: 51.0, lon: 11.0 },    // 2
    { name: 'Delta Hbf', lat: 50.5, lon: 11.5 },    // 3
    { name: 'Delta Süd', lat: 50.49, lon: 11.5 },   // 4, five minutes on foot from Delta Hbf
    { name: 'Epsilon Hbf', lat: 50.0, lon: 12.0 },  // 5
  ];
  const lines = ['RE1', 'RB2', 'RE3', 'RE5', 'RB6', 'RE8'];
  const ALL = 0b1111111, DAY0 = 0b1;
  const stop = (st, arr, dep) => ({ st, arr: hm(arr), dep: hm(dep ?? arr) });
  const trips = [
    { line: 0, term: 2, svc: ALL, stops: [stop(0, '06:00'), stop(1, '07:00', '07:02'), stop(2, '08:00')] },   // 0 RE1 Alpha-Beta-Gamma
    { line: 1, term: 3, svc: ALL, stops: [stop(2, '08:10'), stop(3, '09:00')] },                              // 1 RB2 Gamma-Delta
    { line: 2, term: 3, svc: DAY0, stops: [stop(1, '07:10'), stop(3, '08:50')] },                             // 2 RE3 Beta-Delta, day 0 only
    { line: 3, term: 5, svc: DAY0, stops: [stop(3, '23:40'), stop(5, '24:20')] },                             // 3 RE5 Delta-Epsilon, crosses midnight
    { line: 4, term: 5, svc: ALL, stops: [stop(4, '09:30'), stop(5, '10:00')] },                              // 4 RB6 Delta Süd-Epsilon
    { line: 5, term: 3, svc: ALL, stops: [stop(1, '10:30'), stop(3, '12:00')] },                              // 5 RE8 Beta-Delta
    { line: 0, term: 1, svc: ALL, stops: [stop(0, '05:00'), stop(1, '05:50')] },                              // 6 RE1 early Alpha-Beta
    { line: 3, term: 5, svc: 0b10, stops: [stop(3, '00:10'), stop(5, '00:50')] },                             // 7 RE5 night train, day 1 only
  ];
  return buildFixture({ stations, lines, trips, foot: [[3, 4, 5], [4, 3, 5]] });
}

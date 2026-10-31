# Chain Traveler

Chain the next regional trains between any two German stations on the Deutschlandticket, with an optional
stop-over, and see where you can get to by when. A progressive web app: the whole timetable lives on the
device, so it plans offline in tens of milliseconds. No account, no tracking, no ads, no server.

Licence: MIT. Timetable data: gtfs.de, data provided by DELFI e.V., CC BY 4.0 (see "Data and attribution").

## What it does

| Screen | What you get |
|---|---|
| Chain | Earliest chain of trains from a start to a target station after a time, on a chosen date. Optional stop-over with a minimum stay: it arrives at the stop-over as early as possible, waits out the stay, then chains onward as early as possible. Walks between nearby stations, tight changes flagged, and the next trains at every stop so you can swap the plan on the day. |
| Reach map | Every station as a dot, coloured by how soon you can be there from the start. Click a dot to chain a trip there. |
| Departures | The next trains at any station after a time. |

## Run it

```sh
scripts/fetch-feed.sh      # download the feed (about 12 MB) and build app/data/ (about 5 MB)
./serve.sh                 # http://localhost:8765
npm test                   # engine unit tests on an in-memory timetable, no feed needed
npm run test:feed          # engine tests against the built feed in app/data/
```

Needs Node 22 or later (tests only) and Python 3 (timetable build, standard library only). The app has no
runtime or build dependencies. Open the page once online: a service worker then caches the app and the
timetable, and it opens offline. On a phone, use "Add to Home Screen".

## Data and attribution

- Source: gtfs.de, "Schienenregionalverkehr Deutschland" (`https://download.gtfs.de/germany/rv_free/latest.zip`),
  generated daily from the DELFI NeTEx data.
- Licence of the data: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Attribution: **gtfs.de, data
  provided by DELFI e.V.** The app footer carries it; the built `meta.json` carries it with the feed's sha256.
  The data is converted to a compact binary form (stations merged from platforms, connections between
  consecutive stops, footpaths within 300 m); no other change.
- Content: every regional train (RE, RB, S-Bahn, regional tram) in Germany, about 107,000 trips and 7,600
  stations, a rolling window of 31 days from the day the feed was generated.
- Planned times only. No delays, cancellations or engineering works. International trains are not in it.
- The Deutschlandticket covers these trains and no ICE or IC; long-distance trains are not in the feed.

## How it works

1. `build/build_timetable.py` reads the GTFS files. Platforms merge into their parent station. Every pair of
   consecutive stops on a trip becomes a connection (from, to, departure, arrival, trip, flags) in whole
   minutes; a trip carries a 31-bit mask of the days it runs on. Stations within 300 m get a footpath.
   Output: `timetable.bin.gz` (typed arrays, about 1.5 million connections) and `meta.json` (names,
   positions, line labels, feed provenance).
2. `app/engine.js` runs the connection scan algorithm over the arrays: connections are sorted by departure,
   one pass finds the earliest arrival everywhere, and staying on a trip costs no change time. Four service
   days are scanned together so trips that cross midnight work. Journeys are rebuilt from the connection that
   reached each station.
3. `app/app.js` is the interface: station search, chain view, reach map on a canvas, departures.
4. `app/sw.js` is the service worker: the shell is network-first with a cache fallback, the timetable is
   cache-first.

## Tests

| Suite | Runs | Covers |
|---|---|---|
| `test/unit/` | on every pull request (`npm test`) | The engine on a small in-memory timetable (`test/support/fixture.mjs`): earliest chains, change times, footpaths, stop-overs, midnight crossings, days a trip does not run, departures, station search. Deterministic, no network. |
| `test/feed/` | before a timetable build is published, and locally after `scripts/fetch-feed.sh` | The engine on the real national timetable: size and age of the window, named chains (Wolfsburg to Leipzig and München, München to Wolfsburg via Nürnberg, Wolfsburg to München via Leipzig), the Leipzig footpath, a train past midnight, station search. Days come from the data, bounds are generous ceilings. |

## Known limits and next steps

- Rail only. Buses, trams and U-Bahn (first and last mile) come from a much larger feed (gtfs.de
  "Nahverkehr") and need a regional cut; that is a separate step.
- Weekend gaps are real data, not bugs: some stations have no regional service on Saturdays or Sundays.
- No live delays. gtfs.de offers GTFS-RT as a separate service.

## Security

Report vulnerabilities as described in [SECURITY.md](SECURITY.md). The design keeps the attack surface small:
no server, no secret in the client, no third-party script, no network call other than the app's own files.

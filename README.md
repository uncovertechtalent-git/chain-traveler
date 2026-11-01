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
| Plan B | "My train is out." From where you are, now, to where you are going: the ways on, each set against your plan, drawn as a graph (stations at their real positions, green, amber and red for how late, line thickness for trains an hour) and listed with their changes and tightest change. Press "This train is out?" on a leg of a chain to start from there, or open the tab and say where you are, by name or with "Use my location". |

## Run it

```sh
scripts/fetch-feed.sh      # download the feed (about 12 MB), build it, lay it out in app/data/ (about 5 MB)
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

## Plan B

`app/planb.js` (the logic), `app/graph.js` (the SVG) and `app/live.js` (the tab). All of it works offline on the
timetable on the device, in tens of milliseconds.

1. **The ways on.** You are at a station at a time and some trains are out. The engine skips those runs (a run is a
   trip on one service day, so a cancelled 06:23 does not touch the 06:23 of the next day) and finds the earliest
   chain; then it asks again for the earliest chain that leaves after the first train of the previous one, up to four
   distinct ways inside three hours of the best arrival.
2. **Colour.** How much later than your plan a way arrives, if every train on it runs as planned: green up to 15
   minutes, amber up to 60, red beyond. Without a planned arrival the best way is the yardstick. Every way also says
   it in words ("on plan", "late, +1 h 00 min"), so colour is never the only carrier.
3. **Thickness.** Trains an hour on a leg: the runs that leave the boarding station within half an hour either way and
   call at the alighting station. One is thin, four or more is thick. It says how many fallbacks you have if you miss
   that leg.
4. **Not a probability.** The feed has planned times only: no delays, no cancellations. "Trains an hour" is the
   structure of the timetable, not the chance that a train runs. A real "how likely" needs live data (gtfs.de offers
   GTFS-RT as a separate service), which this does not use. Which trains are out is what you tick.
5. **Where you are.** Pick the station, or press "Use my location": the device is asked for its position once (no
   tracking, nothing stored or sent), the nearest stations that have trains within 40 km are listed with their distance,
   the nearest is filled in, and the date and time are set to now. It works offline, from the device's own positioning.
   The browser asks for permission, and the site's Permissions-Policy has to allow it (`geolocation=(self)`, set in
   site-infra). Times after midnight of the chosen date carry "+1".

## Plan B, the network around you

Behind the ways the graph draws the rest of the network in grey: from where you are, the earliest-arrival tree of the
timetable (the leg that first reaches each station, so every station you can get to within about the time the way on
takes, plus half an hour, has one hairline to the station it is reached from), a dot at each station, and the names
of up to four busy stations that are not near a station on a way. It is context, not advice: it says where else the
trains from here go. It uses the same positions as the ways, only what falls inside the picture is drawn, and the ways
stay on top. It costs one more scan of the timetable (about 80 ms on a laptop), so the ways are drawn first and the
network follows a moment later; it is kept for a redraw with the same inputs.

## Languages

English, Polski, Русский, Română, Български, Українська, Türkçe, Nederlands, Français and Español. The language is the
one you chose (the switch in the header, kept on the device), else the first language of the browser that the app has,
else English. Station names, line names and the name of the app are never translated.

- Every string is a key of `app/locales/en.js`, the source. `app/locales/<code>.js` has exactly the same keys. A value
  that is an object is a plural (`one`, `few`, `many`, `other`), chosen with `Intl.PluralRules` of the language, so the
  Slavic forms are right. Dates, weekdays and numbers follow the language through `Intl`.
- `app/i18n.js` holds `t()` (text) and `th()` (HTML: parameters are escaped), the language switch and the file loading.
  The locale files are ES modules in the shell, precached by the service worker, so a language works offline.
- `test/unit/i18n.test.mjs` fails when a locale lacks a key or has an extra one, when a placeholder differs from the
  English one, when a plural form the language needs is missing, when a value holds markup, when a file is mostly
  English, and when the code asks for a key that does not exist or English holds a key nothing uses.
- **The translations are machine-made and have not been read by native speakers.** A correction is a change to one
  line of one file. A native read per language is the next step.
- To add a language: copy `en.js` to `<code>.js`, translate it, add the code and its name to `LANGS` in `app/i18n.js`
  and the file to `SHELL` in `app/sw.js`; `npm test` says what is missing.

## Hosting and data pipeline

The app is static files on S3 behind CloudFront, at chaintraveler.app. The infrastructure is code in
[uncovertechtalent-git/site-infra](https://github.com/uncovertechtalent-git/site-infra) (private bucket with
origin access control, CloudFront, ACM certificate, DNS, security headers, the two deploy roles). The timetable
is not part of the app release: a daily build publishes it to the same CDN, so data never waits on a code
change or a store review.

| What | When | How | Role (keyless, OIDC) |
|---|---|---|---|
| App shell (`app/`, not `data/`) | push to `main`, after the owner approves the `production` environment | `deploy.yml`: tests, then `scripts/ci/deploy-shell.sh` | `chaintraveler-app-github-deploy`: trusts the `production` environment of this repository; writes the shell objects, denied `data/*`; invalidates one distribution |
| Timetable (`data/`) | daily at 11:17 UTC, and by hand | `timetable.yml`: fetch the gtfs.de feed, build, feed tests, manifest; then `scripts/ci/publish-data.sh` | `chaintraveler-app-github-data`: trusts the `main` branch of this repository; reads and writes `data/*` only |

How a timetable build moves, and what stops a bad one:

1. **Build job, no cloud access.** Fetch `rv_free/latest.zip`, run `build/build_timetable.py`, run the feed tests
   (`npm run test:feed`: size and age of the window, named chains, a midnight crossing). A failing gate stops
   the run before anything is published, and the previous build stays current.
2. **Manifest.** `build/manifest.py make` writes `data/<date>/timetable.bin.gz` and `meta.json` and
   `data/latest.json`: `{format, date, sha256, bytes, metaSha256, metaBytes, firstDate, nDays, built, feedSha256}`.
3. **Publish job, no third-party code.** It downloads the artifact and checks it against the manifest, skips when
   the feed behind the current `latest.json` is unchanged, refuses to overwrite a dated path with other bytes,
   uploads `data/<date>/` with `Cache-Control: public, max-age=31536000, immutable`, reads it back and verifies it,
   and only then writes `data/latest.json` (not cached at the edge). Then it deletes all but the newest three builds.
4. **Rollback.** Run the Timetable workflow by hand with `rollback_to` set to a kept build (`YYYY-MM-DD`): the
   files are verified and `latest.json` points back at them. Nothing is deleted.

Until the infrastructure exists, `build` runs as a dry run and `publish`, `rollback` and `deploy` are skipped.
Set the repository variable `S3_DEPLOY` to `on` to enable them. They also need `SITE_BUCKET`,
`CLOUDFRONT_DISTRIBUTION_ID` and `AWS_DATA_ROLE_ARN` as repository secrets and `AWS_DEPLOY_ROLE_ARN` as a secret
of the `production` environment (outputs of the site-infra bootstrap and site stacks; none is a credential, they
are secrets so that the log masks the account id).

Dry run on your machine: `scripts/fetch-feed.sh && npm run test:feed` (same layout as the CDN, in `app/data/`, so `./serve.sh` behaves like production).

## Data updates on the device

The app keeps the timetable in Cache Storage and updates itself; there is nothing to install or approve
(`app/data-store.js`, `app/sw.js`).

1. **Launch.** The build in use is read from the device and verified again (length and sha256 of both files), so
   the app opens at once, offline too. A damaged or altered entry is dropped, never used.
2. **Check.** When online, the app fetches `data/latest.json` (never cached) and compares date and hashes with the
   build in use. Nothing new: no data is downloaded. The app follows the published pointer, also back to an older
   build after a rollback.
3. **Download, verify, store.** `data/<date>/timetable.bin.gz` and `meta.json` are downloaded; each must match the
   length and sha256 in the manifest (`crypto.subtle`) before it is stored under that build's own cache.
4. **Swap.** The pointer (`ct-data-pointer`) is written last, in one `put`; the engine switches to the new build in
   the page, the chosen stations and day carry over by name. Only then are older builds deleted.
5. **Failure.** Offline, a bad manifest or a newer manifest format, wrong bytes, a full disk: the half-written
   build is removed, the old data stays, and the data-age line says what happened.

The data-age line under the title shows the build date and the last day the timetable covers; it turns into a
warning three days before the window ends and says so plainly after it. On a first launch there is no build yet,
so that launch needs a connection.

The shell is separate: `sw.js` precaches each release into its own cache (versioned by a hash of the shell files,
filled in by the deploy), serves it network-first, and falls back to the cached release offline.

What the sha256 protects, and what it does not: it catches truncated, damaged and mismatched files, including a
partly synced publish. It does not authenticate the publisher, because the manifest comes from the same origin as
the files; that trust rests on TLS and on the roles that alone can write the bucket. Signing the manifest is the
next step if the threat model ever needs it.

## Tests

| Suite | Runs | Covers |
|---|---|---|
| `test/unit/` | on every pull request (`npm test`) | The engine on a small in-memory timetable (`test/support/fixture.mjs`): earliest chains, change times, footpaths, stop-overs, midnight crossings, days a trip does not run, departures, station search, the stations nearest to a position. The update flow (`data-store.test.mjs`) against a fake Cache Storage and CDN: first launch, nothing new, update and swap order, corrupted, truncated and oversized downloads, a second file that fails, offline, a full disk, a failing pointer write, a damaged cache entry, rollback, concurrent calls. Guards on the shell (`shell.test.mjs`): the precache list matches the files, no inline script or style (strict CSP), no external URL. The service worker against a cache that honours `Vary` (`sw.test.mjs`). Plan B on a small corridor timetable (`planb.test.mjs`): runs marked out, trains an hour, bands, the ways and their order, the graph model and the SVG; the network around a journey on a small star network (`context.test.mjs`): the earliest-arrival tree, walks, the time cut, runs marked out, and how the SVG draws it. Deterministic, no network. The languages (`i18n.test.mjs`): same keys, placeholders and plural forms in every locale, no markup, and every key used. |
| `test/build/` | on every pull request (Python `unittest`) | The manifest and its checks (changed byte, truncated or missing file, malformed fields), retention of three builds, and `scripts/ci/deploy-shell.sh` and `publish-data.sh` against a fake AWS CLI: the shell deploy never writes under `data/`, the publish never writes outside it, the pointer is written last, a same-day build with other bytes is refused, a damaged upload leaves the old pointer. |
| `test/feed/` | before a timetable build is published, and locally after `scripts/fetch-feed.sh` | The engine on the real national timetable: size and age of the window, named chains (Wolfsburg to Leipzig and München, München to Wolfsburg via Nürnberg, Wolfsburg to München via Leipzig), the Leipzig footpath, a train past midnight, station search, and Plan B with the planned first train out (ordered ways, none of them the cancelled run, well under a second). Days come from the data, bounds are generous ceilings. |

## Known limits and next steps

- Rail only. Buses, trams and U-Bahn (first and last mile) come from a much larger feed (gtfs.de
  "Nahverkehr") and need a regional cut; that is a separate step.
- Weekend gaps are real data, not bugs: some stations have no regional service on Saturdays or Sundays.
- No live delays. gtfs.de offers GTFS-RT as a separate service.

## Privacy

The app has no account, no analytics script and no request to anyone but its own origin. It keeps in your browser only
the timetable and your last inputs. The position that Plan B reads stays on the device. The CDN that serves the files
keeps access logs: date and time, edge location, path, status, bytes, referrer, User-Agent and the country CloudFront
derives, and never an IP address, cookie or query string. Raw logs are deleted after 30 days; what is kept are counts
(page views, countries, bots by name). The setup is public in
[site-infra](https://github.com/uncovertechtalent-git/site-infra).

## Security

Report vulnerabilities as described in [SECURITY.md](SECURITY.md). The design keeps the attack surface small:
no server, no secret in the client, no third-party script, no network call other than the app's own files.

# Chain Traveler

Chain the next regional trains between any two German stations on the Deutschlandticket, with an optional
stop-over, and see where you can get to by when. A progressive web app: the whole timetable lives on the
device, so it plans offline in tens of milliseconds. No account, no tracking, no ads, no server.

Licence: MIT. Timetable data: gtfs.de, data provided by DELFI e.V., CC BY 4.0 (see "Data and attribution").

Think of it as GPS for the Deutschlandticket: where you are, where you are going, the trains the ticket allows, and a
new route when one of them does not come. It is also a worked example of two things, told as short stories in
[docs/graphs-by-parable.md](docs/graphs-by-parable.md) (how a timetable is a graph, and what "recalculating" means on one)
and [docs/infrastructure-as-amplifier.md](docs/infrastructure-as-amplifier.md) (what a small pipeline amplifies, with the
failures of the first day left in).

## What it does

The page opens on Plan B. One bar above the tabs says where you are, where you are going, the day and the time, and every tab
reads it, so no tab keeps an answer to a question that was asked a while ago: change a station in Plan B and the chain, the
departures and the reach map are about the new one. The bar has a "Use my location" button and a "Now" box. With "Now" on, the
day and the time follow the clock of Germany, and the Plan B list is drawn again when the minute moves; a day or a time set by
hand turns it off. A start that came from the device's position is read again when the page is shown again, if the device
allowed it already (no question is asked on its own), and is dropped at the next visit if the device will not say it again,
because an "I am at" from yesterday is wrong. A station that was picked stays. The stop-over, the minimum stay and "Plan chain"
are in the Chain tab; the minimum change is under the bar. `app/here.js` holds the rules (the clock of Germany, what a tick
changes, what becomes of a position from the last visit) as plain functions with tests.

A sun or moon button beside the language box switches between the light and the dark theme. With nothing chosen the page follows
the device; a choice is kept in this browser and applied before the first paint (`app/theme-boot.js`, a plain script in the
head, because a module is deferred; `app/theme.js` holds the button and the rules).

| Screen | What you get |
|---|---|
| Chain | Earliest chain of trains from a start to a target station after a time, on a chosen date. Optional stop-over with a minimum stay: it arrives at the stop-over as early as possible, waits out the stay, then chains onward as early as possible. Walks between nearby stations, tight changes flagged, and the next trains at every stop so you can swap the plan on the day. |
| Reach map | Every station as a dot, coloured by how soon you can be there from the start. Click a dot to chain a trip there. |
| Departures | The next trains at the station you are at, after the time of the bar. |
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
  consecutive stops, footpaths within 300 m); no other change. A station is named by its parent station, or by its
  platforms where they carry the city and the parent does not: in the Stuttgart area the feed's parents are
  "Hauptbahnhof" and "Feuersee" and their platforms "Stuttgart Hbf" and "Stuttgart Feuersee", and the app shows the
  platforms' names, so the city finds its stations (`station_name` in `build/build_timetable.py`: a parent named only by a
  kind of station, like "Hbf", always yields to a platform name that carries a place; any other parent yields only when every
  platform has the same longer name).
- Content: every regional train (RE, RB, S-Bahn, regional tram) in Germany, about 107,000 trips and 7,600
  stations, a rolling window of 31 days from the day the feed was generated.
- Planned times only. No delays, cancellations or engineering works. International trains are not in it.
- The Deutschlandticket covers these trains and no ICE or IC; long-distance trains are not in the feed.
- Map behind the graphs: [Natural Earth](https://www.naturalearthdata.com/), public domain; see "The map behind the graphs".

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
   minutes, amber up to 60, red beyond. The plan comes from the chain or from Navigate that you came from; without one the best way is the yardstick (there is no box to type a planned arrival into: every way shows the time it arrives and how much later than the best it is, and you pick). Every way also says
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

## Navigate

Press "Follow this chain" on a chain, or "Follow this way" on a way in Plan B, and a card stays at the top of every tab: what
to do now ("Next: RE6 from Wolfsburg Hbf to Magdeburg Hbf, leaves 06:23, in 13 min", "On the RE6: get off at Magdeburg Hbf at
07:28", "At Magdeburg Hbf: RE30 leaves 07:35, in 5 min"), what comes then, and the arrival against the plan you started
with, and a map of it: your route bold, you on it (the position the device gave, else where the clock puts you, moving along
the line while you ride), the other ways coloured green, amber and red by how much later they arrive if the next train is
out, and, after a recalculation, the plan you had dotted. This is GPS on the trains the Deutschlandticket allows, and like a
GPS it recalculates by itself when you leave the route. On a train network "leaving the route" means two things:

- **You missed the train.** Either you say so ("I missed it"), or, if you allow position tracking, you are still within 600 m of
  its station two minutes after it left. Without a position the app assumes you are on board, as a GPS assumes you are on the
  road, and "I'm on board" only settles the doubt.
- **You are not where the plan needs you.** With tracking on, you are more than a kilometre from the station you should board
  at and the train leaves within 20 minutes: the app plans from the nearest station with trains, from where you are now.

A recalculation is the Plan B search from the station and the minute you are at: the missed train is out for good, the ways
are set against the arrival you first planned, the best one becomes the new chain, and the card says what it did and what it
cost ("Recalculated: you did not get the RE6 of 06:23. New arrival 10:30, 1 h 00 min later than planned"). "Other ways (Plan B)"
opens all of them, from the same station and minute, and any of them can be followed instead.

What it keeps and what it sends: the chain you follow is kept on the device (by station names and times, so a new timetable
does not break it) until you press Stop. Position tracking is a button, not a default; the position is used on the device to
find the nearest station and is never stored or sent. A "Test the clock" box lets you walk through a chain on any day.

What it does not know: delays and cancellations (the timetable has planned times only), so "missed" comes from you or from your
position. A phone that sleeps stops the app's clock; it catches up the moment the page is visible again. Tracking uses the
device's positioning, which uses battery; stop it when you do not need it.

## The map behind the graphs

The Plan B graph and the Navigate graph are drawn over a map of Germany and its neighbours: land, the German states, the
larger rivers, lakes and the names of the biggest cities, in quiet colours for the light and the dark theme. "Show map"
under a graph switches it; it is one choice for both graphs, kept in this browser, and on by default. The map is a file
of the app (`app/basemap-data.js`, about 75 KB, 30 KB compressed, precached with the rest of the shell), not tiles: it
works offline, and there is no tile provider, no key and no request. It is a backdrop to see where you are, not a street
map: the lines are simplified to about a kilometre. The stations and the map go through one projection, so a station lies
where it is on the map.

**Source and licence.** [Natural Earth](https://www.naturalearthdata.com/) is in the public domain. The 10 m files used:
countries, the German states, river centre lines, lakes and populated places (cities of 150,000 or more, with their German
names). `build/basemap.py` (standard library only) turns the five GeoJSON files into `app/basemap-data.js`: lines simplified
with Douglas-Peucker at 0.01 degrees, kept only if they reach the box around Germany, written as integers (the first point,
then differences). The header of the output names the sha256 of every input. The output is committed, so a build never needs
the network for it. To change the map:

```
mkdir ne && cd ne
for f in admin_0_countries admin_1_states_provinces rivers_lake_centerlines lakes populated_places; do
  curl -fsSLO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_$f.geojson
done
cd .. && python3 -I build/basemap.py ne app/basemap-data.js
```

**Zoom and pan.** Drag the graph to move it. Zoom with the + and - buttons, a double click, a pinch, or Ctrl or Cmd with the
wheel (a plain wheel keeps scrolling the page). With the graph focused, the arrow keys move it, + and - zoom and 0 fits.
"Fit" shows the whole journey again. It is not animated: the picture is drawn again at the new view (`app/zoomview.js` holds
the gestures and their maths, `app/graph.js` draws), only the lines that reach the picture are drawn and points less than a
pixel apart are left out, so a draw takes a few milliseconds. The zoom goes from half to 8 times; at the deepest zoom the
lines show their kilometre. In Navigate the view stays while the clock and your position update; a new chain starts at fit.
At fit a finger on a phone still scrolls the page; once the graph is zoomed, a finger moves the map, and "Fit" gives the
swipe back to the page.

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
   the feed behind the current `latest.json` is unchanged (unless a run by hand asks to republish, step 5), refuses
   to write a dated path that already holds other files (the files there are compared with the build: `timetable.bin.gz` byte
   for byte, `meta.json` in everything but `feed.built`, the time the build was made, which a rebuild never repeats; when
   they are the same there is nothing to upload and only the pointer moves, made from the published files), uploads `data/<date>/` with `Cache-Control: public, max-age=31536000, immutable`, reads it back and verifies it,
   and only then writes `data/latest.json` (not cached at the edge). Then it deletes all but the newest three builds.
4. **Rollback.** Run the Timetable workflow by hand with `rollback_to` set to a kept build (`YYYY-MM-DD`): the
   files are verified and `latest.json` points back at them. Nothing is deleted.
5. **Republish.** Run the Timetable workflow by hand with `republish` ticked (an input of the workflow, passed to
   `publish-data.sh` as `REPUBLISH`) to publish a build of a feed that is already published: a change in how the
   timetable is built from the same feed (the station names, say), which the daily run skips because the feed is
   unchanged. The build is dated by its feed (`data/<feed date>/`, plain `YYYY-MM-DD`: the app and its service worker
   match that shape, so there is no other naming), and nothing already published ever changes, because a dated
   `meta.json` is cached for a year. A rebuild of a published build with the same code is not another build (it differs only
   by `feed.built`): the run keeps the published files and points, and signs, the pointer at them. The limit: when that path
   is already taken by a build with another timetable or another `meta.json`, the run stops with "nothing already published ever changes" and the change waits for the next feed, which has another date.
   With the input unset a run behaves as before. The job summary says which path was taken: published, skipped,
   republished, nothing to upload, or refused.

Until the infrastructure exists, `build` runs as a dry run and `publish`, `rollback` and `deploy` are skipped.
Set the repository variable `S3_DEPLOY` to `on` to enable them. They also need `SITE_BUCKET`,
`CLOUDFRONT_DISTRIBUTION_ID` and `AWS_DATA_ROLE_ARN` as repository secrets and `AWS_DEPLOY_ROLE_ARN` as a secret
of the `production` environment (outputs of the site-infra bootstrap and site stacks; none is a credential, they
are secrets so that the log masks the account id).

Dry run on your machine: `scripts/fetch-feed.sh && npm run test:feed` (same layout as the CDN, in `app/data/`, so `./serve.sh` behaves like production). One difference: a build made on your machine is not signed, and the app refuses an unsigned manifest while `app/keys.js` lists a key (the data-age line says `signature`). To look at the app on your own build, set `MANIFEST_KEYS = {}` in `app/keys.js` for that session and do not commit it.

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

## Signed manifest

What the sha256 in the manifest protects, and what it does not: it catches truncated, damaged and mismatched files,
including a partly synced publish. It does not say who published them: the manifest comes from the same origin as the
files, so on its own anyone who can write the bucket could publish a consistent, wrong timetable. The signature closes
that.

- **What is signed.** `data/latest.json` carries `kid` (which key) and `sig` (ECDSA P-256 with SHA-256, `r|s`, base64)
  over its own canonical form: every field except `sig`, keys sorted, no spaces (`build/manifest.py canonical`). The
  hashes of both files are in the manifest, so the signature covers the build.
- **Who signs.** An asymmetric AWS KMS key that only the data role may use (site-infra: `kms:Sign`, `kms:Verify`,
  `kms:GetPublicKey` on that one key; the private key never leaves KMS and no secret exists in GitHub).
  `scripts/ci/publish-data.sh` signs just before it writes the pointer, has KMS verify the signature, then checks the
  signature as it ships (`r|s`, converted from KMS's DER by `build/manifest.py`) against the public key with openssl, and
  stops without moving the pointer if either does not accept it: a fault in the conversion cannot publish a signature that
  every app holding the key rejects. Rollback signs and checks too. The repository secret `SIGNING_KEY_ARN` turns it on.
- **Who checks.** `app/keys.js` lists the public keys the app trusts (key id to base64 SubjectPublicKeyInfo). With a key
  listed, `app/data-store.js` accepts a manifest only if its `kid` is listed and the signature verifies
  (`crypto.subtle`), before any build file is downloaded; otherwise the update stops, the data on the device stays, and
  the data-age line says `signature`. With no key listed the app checks hashes only, as before: that is how the shell
  ships before the key exists.
- **Turn it on.** 1. Apply the signing key in site-infra (bootstrap, by the operator). 2. Set `SIGNING_KEY_ARN` and run
  the timetable workflow by hand with `rollback_to` set to the date of the live build (nothing is rebuilt or uploaded; the
  pointer is made from the published files and signed): the pointer now carries `kid` and `sig`, and an app that holds no key ignores both, so
  nothing changes on a device. 3. Read the public key (`aws kms get-public-key`) and its id
  (`python3 build/manifest.py kid-of <base64 key>`), put them into `app/keys.js`, release the shell. The other order (the key
  in the app before the pointer is signed) opens a window in which a device that updates the shell finds an unsigned
  manifest, keeps its old timetable and says `signature`.
- **State.** Steps 1 to 3 are done: the key `d5c56622` is listed in `app/keys.js`, and the pointer of the live build carries
  its signature (`test/support/signed-pointer-2026-10-31.json` is that pointer, signed by KMS in production; the unit test
  checks it against the listed key). Every publish and rollback signs from here on: a build written to the bucket any
  other way is refused by every app that has this shell.
- **Rotate.** List the new key beside the old one, release, switch `SIGNING_KEY_ARN`, remove the old key a release later.
- **What it does not close.** The daily build runs unattended on `main` with the data role: whoever controls that
  workflow can have a manifest signed. The signature protects against a stolen or leaked data role's S3 rights, a
  bucket-policy mistake and a CDN-level compromise, not against a compromised `main`. A signed older manifest is still
  valid, so someone who can write the bucket could replay an old real build (a downgrade to a real older timetable, not
  a forged one); the app already follows the published pointer back to an older build after a rollback, and cannot
  tell the two apart.

## Tests

| Suite | Runs | Covers |
|---|---|---|
| `test/unit/` | on every pull request (`npm test`) | The engine on a small in-memory timetable (`test/support/fixture.mjs`): earliest chains, change times, footpaths, stop-overs, midnight crossings, days a trip does not run, departures, station search, the stations nearest to a position. The update flow (`data-store.test.mjs`) against a fake Cache Storage and CDN: first launch, nothing new, update and swap order, corrupted, truncated and oversized downloads, a second file that fails, offline, a full disk, a failing pointer write, a damaged cache entry, rollback, concurrent calls. Guards on the shell (`shell.test.mjs`): the precache list matches the files, no inline script or style (strict CSP), no external URL. The service worker against a cache that honours `Vary` (`sw.test.mjs`). The manifest signature (`signing.test.mjs`): a golden manifest signed with openssl and checked by WebCrypto, canonical bytes equal to the Python ones, every field covered, unsigned and foreign-key manifests refused before any download, rotation, rollback, and an app with no keys unchanged. Navigate on the corridor timetable (`navigate.test.mjs`): where you are in a chain at each minute, missed by word or by position, not at the station, recalculation with the missed run kept out, and what is stored between launches. Plan B on a small corridor timetable (`planb.test.mjs`): runs marked out, trains an hour, bands, the ways and their order, the graph model and the SVG; the network around a journey on a small star network (`context.test.mjs`): the earliest-arrival tree, walks, the time cut, runs marked out, and how the SVG draws it. The map and the zoom (`basemap.test.mjs`, `zoomview.test.mjs`): the map is drawn through the projection of the stations, only where the picture is, kept while the projection stays, switched off cleanly; the maths of pan, zoom and pinch (the point under the pointer stays, the limits hold). Deterministic, no network. The languages (`i18n.test.mjs`): same keys, placeholders and plural forms in every locale, no markup, and every key used. |
| `test/build/` | on every pull request (Python `unittest`) | The manifest and its checks (changed byte, truncated or missing file, malformed fields), retention of three builds, the canonical form, the DER signature conversion, the check of the shipped `r|s` with openssl and the key id (`test_signing.py`), and `scripts/ci/deploy-shell.sh` and `publish-data.sh` against a fake AWS CLI (with a fake KMS on openssl, so the signature is checked by openssl itself): the shell deploy never writes under `data/`, the publish never writes outside it, the pointer is written last, a same-day build with other bytes is refused, a damaged upload leaves the old pointer, a republish of a published feed only when asked, and a dated build that is never overwritten by another one (other station names under the same timetable bytes included), while one that is already there in full uploads nothing and only the pointer moves. The station names (`test_station_names.py`): the rules of `station_name` (the Stuttgart case and its mirror, ties, platforms that disagree, platform names that do not extend the parent) and a small feed built twice, with and without the rule, to show that only the names change. The map builder (`test_basemap.py`): simplification keeps shape and ends (closed rings too), encoding round-trips, the layers and the cities of a synthetic Natural Earth, and the committed map (size, extent, header). |
| `test/feed/` | before a timetable build is published, and locally after `scripts/fetch-feed.sh` | The engine on the real national timetable: size and age of the window, named chains (Wolfsburg to Leipzig and München, München to Wolfsburg via Nürnberg, Wolfsburg to München via Leipzig), the Leipzig footpath, a train past midnight, station search, and station names carry their city (Stuttgart Hbf exists, no station is named exactly Hbf, Hauptbahnhof or Bahnhof, searching Stuttgart finds Stuttgart), and Plan B with the planned first train out (ordered ways, none of them the cancelled run, well under a second). Days come from the data, bounds are generous ceilings. |

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

# Infrastructure as an amplifier

An amplifier makes a signal bigger and does not care what the signal says. Infrastructure is that for software: the same
twenty lines of configuration reach one person or a million, the same good decision, and the same bad one. Chain Traveler is
a small example you can read end to end: one app, one bucket, one pipeline, and a record of what went right and wrong
when it first went live.

## What is amplified

| The piece | What it amplifies | What it costs, or risks |
|---|---|---|
| Infrastructure as code: one `static-site` module, three sites | One careful design is reused: chaintraveler.app is the same bucket, CDN, certificate and headers as the older sites, in a stack of about two dozen resources | A mistake in the module is a mistake in every site that uses it |
| A CDN in front of a private bucket | One copy of the app, served from the edge nearest each device; the cost per extra user is one download | A wrong header reaches every user at once |
| Immutable dated builds, and a pointer written last | Nothing already published ever changes, so a bad timetable is undone by moving one small file | The pointer is the one thing that can be wrong, so it is the thing that is guarded |
| Keyless CI (OIDC, two roles) | No secret to leak: a workflow gets a token valid for minutes. The shell role cannot touch the data and the data role cannot touch the shell | The trust rules are code that has to be read; one typo in a policy blocked the first apply |
| A manifest with hashes, and a signature | One manifest of a few hundred bytes vouches for 5 MB on every device | The key is one more thing to keep, rotate and explain |
| Tests, and breaking the code to see them fail | A mistake found once stays found for every later change | A test that never fails proves nothing, so each one here has a version of the code it must reject |
| Logs without IP addresses, shipped to a dashboard | You can see use without collecting people | Offline use is invisible: the numbers are a floor |
| A review gate (rulesets, a required reviewer, draft pull requests) | One person can approve what several agents built in a day | The gate is the slowest part, on purpose |

## The first day, with the failures left in

The site went from a repository to a live HTTPS domain on 1 November 2026. Four things went wrong, and each one shows
the amplifier running the wrong way.

1. **A header became an outage.** The CDN added `Vary: Origin` to every response, copied from an older site's setup. Chrome
   sends an `Origin` header on module scripts, so the service worker's cache lookup missed, and the **first launch offline**
   failed for everyone, in a way no local test showed. The fix is in the app (look up the cache ignoring `Vary`) and in the
   infrastructure (stop sending the header for a site that is one origin). The lesson is in the testing: the app now has a
   test that runs the real service worker against a cache that honours `Vary`, and the browser check runs against the
   production headers, not only a local server.
2. **A typo blocked the pipeline.** The apply role's policy named a CloudFront log action in the plural. The first
   Terraform apply in CI failed with `AccessDenied`. A test now holds the spelling.
3. **A guard refused a good build.** Builds were named by the day they were built; the data provider regenerates its
   feed around 09:40 UTC, so two different feeds on one day would share a path. The publish script refuses to overwrite a
   build with other bytes, by design, and it would have refused the second one. The fix is to name a build by the date
   of its feed. The guard was right; the naming was wrong.
4. **A gap in the data became a gap for everyone.** The published feed has no Saturday trains and almost no Sunday trains at
   one large station. The pipeline carried it faithfully, and so would a million devices. Faithful is not the same as
   right. Somebody has to read the data.

## The firehose, in numbers

Point a crowd at a static site and almost nothing grows except data transfer. The app's timetable is about 5.2 MB
(plus 0.3 MB of names), downloaded once per device and again whenever a new build is published. At a list price of roughly
0.085 USD per GB out of the CDN (the first price tier, so a large volume is cheaper per GB than shown; check the current price list; the price class here is
the cheapest one):

| Devices | First install | If every device updates daily for a month |
|---|---:|---:|
| 1,000 | about 5.5 GB, 0.5 USD | about 164 GB, 14 USD |
| 100,000 | about 550 GB, 46 USD | about 16 TB, 1,400 USD |
| 1,000,000 | about 5.5 TB, 460 USD | about 164 TB, 14,000 USD |

The first column is cheap. The second is the dial that matters: a daily full download per active device is what costs money
at scale, and it is a design choice, not a law. Fetching a new timetable only when the one on the device is about to run
out would cut it to roughly a tenth, at the price of staler data. The amplifier will do whichever you choose,
at any scale.

## The rule that comes out of it

An amplifier needs a gate, a meter and a way back. The gate here is a reviewer who approves every merge and every
deploy. The meter is the traffic dashboard and the spend view. The way back is a pointer that can be moved to an older
build in one workflow run. Without those three, the same infrastructure is a way to make a mistake faster.

# Security policy

Chain Traveler is a static web app. It has no server, no account, no database and no analytics; the timetable
is routed on the device. What can go wrong is therefore narrow: a flaw in the app code, in the build and
deploy pipeline, or in the timetable files served from the CDN.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: the **Security** tab of this repository, then **Report a
vulnerability**. Please do not open a public issue for a vulnerability.

This is a one-person project. Expect an acknowledgement within a week and a fix or a decision within a
month; the reply says which. There is no bug bounty.

## In scope

- Cross-site scripting or injection through station names, the shared-chain link or the timetable files.
- Anything that lets a changed timetable file be accepted without matching its published sha256.
- Weaknesses in the workflows under `.github/workflows` (token scope, injection, unpinned actions) or in the
  AWS roles they assume.
- A response header or caching rule on the hosted app that weakens its protections.

## Out of scope

- Wrong or missing trains: the timetable is third-party data, planned times only. Report data faults to the
  feed's publisher (gtfs.de, data provided by DELFI e.V.).
- Findings that need a modified browser, a rooted device or access to the user's profile.

## Supported versions

Only the version deployed from the `main` branch. There are no long-lived release branches.

## What the project holds

No secret is stored in this repository or in the client. Deploys are keyless: GitHub Actions exchanges its
short-lived OIDC token for an AWS role session that can write one bucket. Actions are pinned to commit SHAs.
See the README, section "Security".

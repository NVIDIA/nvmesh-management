<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# AGENTS.md

Guidance for AI coding agents working in the **NVMesh Management** repo. Optimized for what an agent needs to be useful here. Human-facing docs live in `README.md`, `public/introduction.md`, and `public/docs/`.

## Overview

Management server for NVMesh (NVIDIA's distributed block storage). Express-based Node.js app that exposes the REST/Websocket API, persists configuration in MongoDB, communicates with cluster nodes (target/client) via Kafka, and ships a server-rendered + React frontend out of `public/`.

## Related repos

This codebase references and coordinates with several other NVMesh components. When the task requires reading or modifying their code, fetch them from:

| Component | Repo |
|---|---|
| `interop-db` (required sibling, must live at `../interop-db`) | <https://gitlab-master.nvidia.com/excelero/interop-db/> |
| `client`, `target`, `TOMA`, `managementAgent`, `MCS` | <https://gitlab-master.nvidia.com/excelero/nvmesh> |
| `upgrader` / `UpgradeAgent` | <https://gitlab-master.nvidia.com/excelero/upgrader> |

Don't guess their behavior from names referenced in this repo — read the source in the appropriate repo when correctness depends on it.

## Stack

- **Runtime:** Node.js `>=17 <19` (see `package.json` `engines`).
- **Web:** Express 5, EJS layouts (`views/`), Passport (local + client-cert).
- **DB:** MongoDB (`mongodb-legacy`, `winston-mongodb`). Sibling repo `../interop-db` is a hard dependency (`preinstall` checks for it).
- **Messaging:** Kafka via `kafkajs`. Topics + routing in `modules/kafka.js`, `modules/kafkaRouter.js`.
- **Realtime:** `socket.io` + custom websocket layer (`modules/websocket.js`, `models/websocketMessages/`).
- **Frontend:** React 18 (transpiled with Babel via Gulp), Sass, served from `public/`. JSX is rewritten to `.js` at build time (see `.babelrc.js` `module-resolver`).
- **Validation:** `ajv` JSON schemas under `validationSchemes/`, plugged in via `middlewares/isValidRequest.js`.
- **Telemetry:** OpenTelemetry SDK (logs/metrics/traces). Bootstrap in `modules/openTelemetry.js`.
- **Lint/test:** ESLint 7 (`.eslintrc.json`), Mocha 9 (`.mocharc.json`).

## Common commands

| Task | Command |
|---|---|
| Install deps (requires `../interop-db` checked out) | `npm install` |
| Build (gulp default) | `npm run build` |
| Start server (after build) | `npm start` |
| Dev mode (build + watchers) | `npx gulp dev` |
| Watchers only | `npx gulp watch` |
| Lint | `npm run lint` (or `npx gulp eslint`) |
| Backend tests (full suite) | `npm test` |
| Single backend test file | `npx mocha --exit test/testVolumes.js` |
| Single test by name | `npx mocha --exit --grep "<pattern>"` |
| Frontend tests | `npm run test-ui` |
| Compile Sass | `npx gulp compileSass` |
| Rebuild React components | `npx gulp buildComponents` |
| Regenerate API docs | `npx gulp apidoc` |

Mocha is `asyncOnly: true` (`.mocharc.json`) — every test must return a promise or use `async`.

## Layout

Backend
- `app.js` — Express bootstrap, route mounting, session, passport, sockets.
- `bootstrapper.js` — startup sequencing (DB, Kafka, services, OT).
- `consts.js` — central enums (component names, statuses, upgrade types, kafka topics, etc.). Add new enums here.
- `routes/` — Express routers, one file per resource. Thin: validate → call module.
- `modules/` — business logic; one file per domain (`volume.js`, `upgrade.js`, `client.js`, `kafkaRouter.js`, …). This is where real work lives.
- `models/` — DB / message schemas (Mongo collections, kafka/websocket message shapes).
- `validationSchemes/` — AJV schemas, mirrors `routes/` layout. `definitions/` holds shared sub-schemas.
- `middlewares/` — auth (`isAuthenticated`, `isAdminRole`), validation (`isValidRequest`), feature gates (`isServiceAvailable`, `isDeprecated`).
- `services/` — long-running services (`nvmeshmgr`, `sendEmailOnServiceStop.js`) and shared helpers in `services_common/`.
- `initServices/`, `system.d/`, `RPM/`, `nginx/`, `prestart.sh`, `build_docker.sh` — packaging / deployment.
- `upgradeScripts/`, `dump/`, `db_dump/`, `recoverdb.sh`, `dbBackup.js`, `restoreDB.sh` — DB lifecycle / migrations.
- `test/` — Mocha specs (`test*.js`), shared helpers in `testCommons/`, `testUtils/`.
- `simulation/`, `slash-tests/` — out-of-process test rigs.
- `ci/`, `.gitlab-ci.yml` — CI config.

Frontend
- `public/javascripts/components/` — React tree (`App.jsx`, `Router.jsx`, `pages/`, `services/`, `shared/`, `core/`).
- `public/javascripts/components_js/` — generated, **do not edit**.
- `public/stylesheets/` — Sass sources.
- `views/` — EJS templates served by Express.

## Conventions

- **Indentation: tabs** (`.eslintrc.json`: `"indent": ["error", "tab"]`). Don't auto-convert to spaces.
- **Quotes:** single. **Semicolons:** required. **Max line length:** 160.
- **Module style:** CommonJS in backend (`require` / `module.exports`). Frontend uses ES modules + JSX, transpiled.
- **Async:** prefer `async/await`; tests must be async (`asyncOnly`).
- **camelCase** for identifiers; `properties: never` allowed (DB / API field names may keep their existing casing).
- **Logging:** use the project logger (`logger.js`), never `console.log` in committed code.
- **Errors:** throw / pass `error.js`-style errors; routes translate to HTTP via the standard error middleware.
- **Adding an endpoint:**
  1. Add route in `routes/<resource>.js`.
  2. Add AJV schema in `validationSchemes/<resource>/` and wire via `isValidRequest`.
  3. Put logic in `modules/<resource>.js` (not in the route handler).
  4. If a new enum value is needed, add it to `consts.js`.
  5. Add a Mocha test in `test/test<Resource>.js` covering happy path + a validation rejection.
- **Adding a Kafka message:** define the shape in `models/kafkaMessages/`, register routing in `modules/kafkaRouter.js`.
- **Adding a websocket message:** define in `models/websocketMessages/`, emit through `modules/websocket.js` / `objectNotifier.js`.
- **Frontend imports:** import `.jsx` files without the extension; the babel `module-resolver` rewrites `.jsx → .js`.

## Tests

- Backend tests live in `test/`, file pattern `test*.js`. Mocha config in `.mocharc.json` (30s timeout, `asyncOnly`, `exit: true`).
- Use helpers in `test/testCommons/` and `test/testUtils/` rather than rolling your own setup.
- New backend behavior should add at least one happy-path test and one failure/validation test.
- Frontend component tests live under `public/javascripts/components/test/` and run via `npm run test-ui`.
- Don't commit `test/test.log`.

## Commits / PRs

- Reference the relevant **NVMESH Jira** ticket in the commit message (e.g. `NVMESH-8543`). The user's `~/.cursor/rules/jira-default-project.mdc` already defaults bare numbers to the NVMESH project.
- Run `npm run lint` and the relevant tests before declaring a task done.
- Don't commit generated frontend output (`public/javascripts/components_js/`), `.patch` files, ad-hoc dumps, or `node_modules/`.
- The repo also has a per-feature Cursor rule at `.cursor/rules/ndu-feature.mdc` — read it before touching NDU/upgrade code.

## Gotchas

- **`interop-db` sibling repo is required.** `npm install` will refuse to run if `../interop-db` doesn't exist. Clone it from <https://gitlab-master.nvidia.com/excelero/interop-db/> into a sibling directory (`../interop-db`).
- **Generated React output (`public/javascripts/components_js/`) is gitignored and rebuilt** by Gulp — never hand-edit, always change the `.jsx` source and rebuild.
- **`.jsx → .js` rewrite** at build time means runtime imports look like `.js` even though sources are `.jsx`. When searching for a module, look for the `.jsx`.
- **Tabs, not spaces.** ESLint will fail the build if you mix.
- **Mongo driver is `mongodb-legacy`.** Don't introduce calls that assume the modern driver's promise-only API without checking the wrapper in `modules/mongoDBWrapper.js` / `modules/mongoDB.js`.
- **`consts.js` is huge and load-bearing** — many modules destructure from it. Add new constants here rather than re-declaring locally.
- **Upgrade / NDU code is intricate.** See `.cursor/rules/ndu-feature.mdc` for the orchestration model (step ordering, locks, `verifyVolumesAvailability`) before changing anything in `modules/upgrade*.js` or `routes/upgrade*.js`.
- **SEC stripe-size rounding:** for `STRIPED_ERASURE_CODING`, `createVolumeByRAIDLevel` silently rounds `stripeSize` up to a multiple of `DEFAULT_STRIPE_SIZE_BLOCKS * dataBlocks` (= `32 * dataBlocks`). The user-supplied value is advisory; downstream code must read it back from the persisted volume. See `.cursor/rules/volume-allocation-feature.mdc`.
- **Ops scripts** (`recoverdb.sh`, `restoreDB.sh`, `dbBackup.js`, `clearDB.js`, `dropDB.js`, scripts under `upgradeScripts/`) touch real DB state — never run them as a side effect of a code task.

## Definition of done

- [ ] Code change scoped to the task; no incidental refactors.
- [ ] `npm run lint` passes.
- [ ] Affected Mocha tests added/updated and `npm test` (or the targeted file) passes.
- [ ] If a route changed: AJV schema updated and `npx gulp apidoc` rerun if API doc text changed.
- [ ] If a constant/enum was introduced: added to `consts.js`.
- [ ] Commit message references the NVMESH Jira ticket.

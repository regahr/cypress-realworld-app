# Implementation notes

Written justifications for each change, per the assessment brief.

## #1607 — remove the `cy.request("GET", "/")` workaround from the API specs

**What was wrong.** Every spec in `cypress/tests/api/` opened with a `before()` hook whose own
comment described it as a "Hacky workaround to have the e2e tests pass when
cy.visit('http://localhost:3000') is called". It issued a bare `cy.request("GET", "/")` purely to
prime something in the runner, and asserted nothing.

**Why this fix.** The workaround is dead weight on the Cypress version this repo now pins (15.17.0,
`package.json`). I removed the hooks rather than rewriting them: there is nothing to preserve, since
the request had no assertions and no setup role — the real per-test setup lives in the `beforeEach`
hooks (`cy.task("db:seed")` + `cy.loginByApi(...)`), which are untouched.

**Honest note on the premise.** The issue states the lines "cause the tests to fail, now". That did
not reproduce here: on Cypress 15.17.0 the full API suite is 51/51 green *with* the hooks still in
place. So this change is removal of a confirmed-obsolete workaround, not a red-to-green fix. The
gate it has to clear is therefore "the suite is still 51/51 after removal", which is how it was
verified.

**What I deliberately did not touch.** The `beforeEach` hooks, every other `cy.request(...)` call
(those exercise real API endpoints and are the point of these specs), and the identical-looking
`before()` hooks' surrounding `describe`/`context` structure.

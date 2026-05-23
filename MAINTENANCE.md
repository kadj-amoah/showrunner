# Maintenance rituals

Recurring checklists that keep Showrunner shippable between feature cycles. See [ROADMAP.md](./ROADMAP.md) for the dated version plan these rituals support.

## Weekly — Monday morning (~1.5 hr)

| Task | Time | What to do |
|---|---|---|
| Issue triage | 30 min | Read every new GitHub issue. Label (`bug`, `feature`, `docs`, `question`), assign to the current cycle's milestone if in-scope, close as out-of-scope otherwise. Reply to any question issue. |
| Patch dependency bumps | 20 min | `npm outdated` → bump patch-version-only updates (`^1.2.3 → ^1.2.4`). Minor and major bumps reviewed individually and deferred to a dedicated cycle task. |
| Security review | 10 min | `npm audit` — fix high / critical; document accepting low / moderate in a tracking issue. |
| Upstream scan | 15 min | Skim release notes for: Playwright, Anthropic SDK, OpenAI SDK, ffmpeg. Flag any breaking changes for the current cycle. |
| Roadmap glance | 15 min | Update the current cycle's checklist in `ROADMAP.md`. If reality is drifting from plan, reshape the next cycle, not the current one. |

**Done when:** issues triaged, deps current within patch, no unaddressed critical CVEs, the next cycle plan reflects what's actually happening.

## Bi-weekly — Friday (cycle close)

End of each ~2-week cycle. Cuts the patch release if anything shippable accumulated.

| Step | What to do |
|---|---|
| 1. Run the full test suite | `npm run typecheck && npm run test && npm run build` — must be green. |
| 2. Doctor against reference target | `showrunner doctor -c D:/demos/ct-website-atlas-demo/demo.yaml` — 10/10 PASS expected (allowing for env-var / dev-server FAILs that aren't regressions). |
| 3. Bump version | `npm version patch` (or `minor` for feature cycles). |
| 4. Update CHANGELOG | Add a `## [x.y.z] — YYYY-MM-DD` entry summarizing the cycle's Added / Changed / Fixed. |
| 5. Commit + tag + push | Includes the new tag — `git push origin main --follow-tags`. |
| 6. Publish to both registries | `GITHUB_TOKEN=$(gh auth token) npm publish` (GH Packages, default), then `npm publish --registry=https://registry.npmjs.org --access=public` (npmjs). |
| 7. Create GH Release | `gh release create vX.Y.Z --notes-file CHANGELOG.md --title "vX.Y.Z — <theme>"` — or via the GH UI if you want to handpick the release body. |

**Done when:** the new version is live on both registries and the GitHub release page is published with notes.

## Monthly — last Sunday

Larger validation than the bi-weekly. Catches regressions the unit tests miss.

| Step | What to do |
|---|---|
| 1. Full e2e against the reference target | `showrunner run -c D:/demos/ct-website-atlas-demo/demo.yaml --force script,record,voiceover,mux` — MP4 should produce, segments should resolve, no `[FAIL]` rows in doctor. |
| 2. Full e2e against a second target | Spin up a different web project (TodoMVC fork, Conduit, a new marketing site). Run `showrunner init` from scratch, walk through `understand --interactive` + `run`. Surfaces inventory-scrape edge cases that don't appear on the Atlas codebase. |
| 3. Read the last 30 days of issues | Look for patterns — three users hitting the same friction = a real bug. One user hitting weird friction = probably edge case. |
| 4. Update the public TODO | If anything in `ROADMAP.md` slipped, move it. If a recurring issue surfaces a pattern, file a v-next bullet. |

**Done when:** two real e2e runs produced playable MP4s with no FAIL rows; ROADMAP reflects observed reality.

## Quarterly — every 3rd monthly cycle

Architectural review. Don't change anything mid-quarter; just review.

| Question | What to check |
|---|---|
| Is the manifest schema holding up? | Look at recent issues + PRs — are people working around the schema? Adding to it? Subverting it? Time to evolve? |
| Are the providers still cleanly abstracted? | Have any new fields leaked from a specific LLM/TTS provider into the generic interface? If so, push them back behind the abstraction or formally extend it. |
| What's the new Tier-3 list? | Re-classify everything in the codebase: production-solid, likely-OK, coded-but-untested. The "untested" list is the next cycle's burndown candidates. |
| Is anything ready to deprecate? | Legacy normalization shims, old config fields nobody uses, providers nobody picked. Mark for v2.0.0 removal. |

**Output of the quarterly:** a short post in `docs/architecture-notes/YYYY-QX.md` capturing the read + any decisions. Becomes the seed of the next cycle's planning.

## Crisis mode — when production breaks

If a published version is broken (someone reports `npm install` produces a non-functional binary, or doctor crashes, or the pipeline produces unplayable output on a clean machine):

1. **Triage** within 24 hr — confirm reproduction; figure out scope (one OS? one provider combo? everyone?)
2. **Patch fix or unpublish** within 48 hr — either ship `x.y.z+1` or `npm unpublish` the broken version (within npm's 72-hr unpublish window; GH Packages has different rules)
3. **Post-mortem** in `docs/incidents/YYYY-MM-DD-summary.md` — what failed, why the testing missed it, what changed to prevent recurrence
4. **Add a regression test** so the failure mode is caught in CI

The point of the cadence above is that crisis-mode is rare. If you're in crisis mode more than once a quarter, the bi-weekly / monthly rituals aren't catching enough.

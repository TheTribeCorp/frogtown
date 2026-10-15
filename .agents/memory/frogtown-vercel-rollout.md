---
name: Frogtown Vercel rollout
description: User-approved rollout policy for moving Frogtown's web and API hosting while preserving existing data.
---

Keep the existing Replit production deployment and PostgreSQL data live during the Vercel rollout. First try Vercel against the current production database; do not migrate data or change the live domain/routing without confirming the plan with the user.

For an existing Vercel project, GitHub source linking must be completed from Project Settings → Git; the project-update API can configure build settings but does not attach a repository. Vercel email alerts are traffic-based 5xx/usage anomaly detections, require Pro or Enterprise with Observability Plus, and are not a synthetic check for an idle database.

Vercel's GitHub project association is separate from the workspace's Git remote. A Vercel-linked repository can still be empty, and the workspace can still point only to its internal backup; verify both repository refs and local remotes before claiming files are synced.

In this project, a Vercel Build Output API function placed at `functions/api/[...path].func` did not catch `/api/*`; requests fell through to the SPA. Route API requests explicitly to an exact `/api` function and restore the original path in the handler.

**Why:** The user chose to try keeping the current database rather than include a database migration in the initial Vercel move. Vercel documents Git linking in the dashboard and its alert thresholds depend on observed traffic, so neither should be represented as an already-configured repo link or continuous database monitor.

**How to apply:** Replit-managed PostgreSQL is only reachable from within Replit, so it cannot serve a Vercel-hosted API. Vercel requires an external PostgreSQL database and a deliberate data migration. Keep the Replit deployment and database live until the external database, Vercel sign-in, chat, and timeline behavior are validated; `/api/healthz` must return JSON with a healthy database. Check the actual GitHub branch and workspace remote before claiming code delivery, and do not change live routing or switch traffic until the user approves.

Vercel Preview and Production have separate environment-variable targets. Replit-managed PostgreSQL cannot be used as Vercel's database even when `DATABASE_URL` is configured; Vercel needs a separately hosted external PostgreSQL database. If Preview and Production later share that external database, Preview writes can affect live records. Keep the Preview session-signing secret separate from Production.

**Why:** The user initially chose to reuse the current production database for Vercel Preview, but the health endpoint returned `database: unavailable`; Replit's official docs confirm managed PostgreSQL is not directly accessible from external deployments.

**How to apply:** Never assume Production secrets are available to Preview. Check variable targets, use a distinct preview session secret, and do not assume a Replit `DATABASE_URL` can be copied to Vercel. Keep the existing database untouched until the user has approved the external destination and migration plan.

Vercel Preview is SSO-protected in this workspace. Unauthenticated HTTP health checks can follow a redirect to Vercel login and return 200 HTML; that is not a successful API health check.

**Why:** The Preview deployment redirected an unauthenticated `/api/healthz` request to Vercel login after the Neon database was configured.

**How to apply:** Keep Preview protection enabled. Verify health JSON from a browser signed into Vercel, or use an explicitly configured automation-bypass secret without exposing it.

The floating menu button seen in Frogtown's protected Preview is Vercel's Toolbar, not an app control. It is intentionally disabled for the current Frogtown Preview branch with `VERCEL_PREVIEW_FEEDBACK_ENABLED=0`; Production was not changed.

**Why:** The user asked to remove the small button that opens GitHub from the interface. Hiding Vercel's Preview Toolbar removes it without deleting any Frogtown navigation or features.

**How to apply:** Keep the setting scoped to Preview. If new Preview branches should also hide the toolbar, add the same branch-scoped setting; don't change Production visibility unless the user asks.

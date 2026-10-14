---
name: Frogtown Vercel rollout
description: User-approved rollout policy for moving Frogtown's web and API hosting while preserving existing data.
---

Keep the existing Replit production deployment and PostgreSQL data live during the Vercel rollout. First try Vercel against the current production database; do not migrate data or change the live domain/routing without confirming the plan with the user.

For an existing Vercel project, GitHub source linking must be completed from Project Settings → Git; the project-update API can configure build settings but does not attach a repository. Vercel email alerts are traffic-based 5xx/usage anomaly detections, require Pro or Enterprise with Observability Plus, and are not a synthetic check for an idle database.

Vercel's GitHub project association is separate from the workspace's Git remote. A Vercel-linked repository can still be empty, and the workspace can still point only to its internal backup; verify both repository refs and local remotes before claiming files are synced.

**Why:** The user chose to try keeping the current database rather than include a database migration in the initial Vercel move. Vercel documents Git linking in the dashboard and its alert thresholds depend on observed traffic, so neither should be represented as an already-configured repo link or continuous database monitor.

**How to apply:** Use the production database connection details when configuring Vercel, never the development database. Keep Replit available until Vercel sign-in, chat, and timeline behavior are verified. Check the actual GitHub branch and workspace remote before claiming code delivery; do not push to the production branch until database and Vercel readiness are confirmed. Use native anomaly email alerts only if the plan supports them, and use an external synthetic monitor for no-traffic DB outages only after the user authorizes one.

---
name: Frogtown Vercel rollout
description: User-approved rollout policy for moving Frogtown's web and API hosting while preserving existing data.
---

Keep the existing Replit production deployment and PostgreSQL data live during the Vercel rollout. First try Vercel against the current production database; do not migrate data or change the live domain/routing without confirming the plan with the user.

**Why:** The user chose to try keeping the current database rather than include a database migration in the initial Vercel move.

**How to apply:** Use the production database connection details when configuring Vercel, never the development database. Keep Replit available until Vercel sign-in, chat, and timeline behavior are verified.

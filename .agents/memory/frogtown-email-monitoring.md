---
name: Frogtown email monitoring
description: GitHub Actions is the no-extra-service fallback for email alerts on production health failures.
---

Use a scheduled GitHub Actions health check and GitHub's failed-workflow email notifications instead of introducing a separate monitoring account or API credential.

**Why:** Vercel Hobby does not provide the native outage-email alerting needed here, and the project should avoid additional credentials where GitHub's notification system is sufficient.

**How to apply:** Keep the monitor on the default branch and check the public production `/api/healthz` response for both API and database status. The GitHub account that owns the schedule must enable Actions email notifications; protected Preview URLs are not suitable monitor targets.

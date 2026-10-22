---
name: Frogtown GitHub release permissions
description: GitHub Actions can build and sign Android APKs, but its token may not have permission to publish releases in this repository.
---

When publishing an Android APK from GitHub Actions, the artifact can build and pass signature verification while the release upload fails with `403 Resource not accessible by integration`. The repository's workflow-permission setting reports `read`, even when the workflow explicitly requests `contents: write`.

**Why:** The Actions token's available release permissions are constrained independently of Replit's connected GitHub user identity, which can push to the repository.

**How to apply:** Keep signing secrets in Actions. After a build artifact and its signatures are verified, use the connected GitHub identity to create and publish the release, or ask the repository owner before changing the repository-wide workflow-token permissions. Never request or copy a user's access token into a workflow.

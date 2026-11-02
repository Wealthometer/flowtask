# Changelog

## 1.0.0 — 2026-11-02

First release.

- Mobile app (Expo SDK 58) with a bold, playful design: chunky outlines, hard shadows, eight project colours, animated checkboxes with confetti, haptics, dark mode.
- Workspaces with invite codes and owner/admin/member roles; account deletion.
- Projects with boards and lists, custom workflow columns and templates, archive and delete.
- Tasks with assignee, due date, priority, labels, notes, checklist, comments with @mentions; quick capture.
- Home focus list, inbox for assignments, comments, mentions and completions, team activity feed.
- Offline-first sync: on-phone outbox, idempotent push, versioned pull, live updates over WebSockets (Postgres LISTEN/NOTIFY), push notifications through Expo.
- API on Fastify and PostgreSQL with migrations, scrypt passwords, hashed session tokens, rate limits.
- 18 API tests, 12 sync-model tests, 4 two-person browser journeys, CI, Docker image and Compose file, EAS build profiles.

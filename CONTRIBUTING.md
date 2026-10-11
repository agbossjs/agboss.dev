# Contributing

Thanks for looking into the AGBoss docs site. This repository is simpler than the framework
itself: Astro + Starlight content and a bit of site code, deployed to [agboss.dev](https://agboss.dev)
on every push to `main`.

## Before you start

1. `npm install`
2. `npm run dev` — local preview with hot reload
3. `npm run build` — must pass before opening a PR; CI runs it again

## Finding or filing an issue

If nothing covers what you want to add or fix, open an issue first — describe why, what it does,
and what it does not do. Labels: `type:feature` · `type:bugfix` · `type:chore` · `type:epic` ·
`prio:mvp` · `prio:stretch` · `blocked` (same convention as [agbossjs/agboss](https://github.com/agbossjs/agboss)).

## Branching and commits

Branch from `main`, never commit to `main` directly once a PR flow is in place for your change —
small fixes may land as a direct commit, larger ones go through a PR. Conventional commits with the
issue number when one exists: `feat(#12): …`, `fix(#13): …`, `docs(#14): …`, `chore(#15): …`.

## Pull requests

- Base: `main`.
- Body follows `.github/pull_request_template.md` and references the issue with `Refs #<issue>`.
- Merge only after `npm run build` / CI is green and the affected page(s) were checked in
  `npm run preview`.

## Content conventions

- Docs content lives under `src/content/docs/` (`getting-started/`, `concepts/`, `reference/`,
  `guides/`, `examples/`) — one page per task under `examples/`, since that's the main SEO channel.
- Keep code samples in sync with the framework (`agbossjs/agboss`) — if the API changed there,
  update the sample here in the same PR or file a linked issue.
- Site code (homepage, nav, shared components) lives in `src/components/` and `src/styles/`.

## Questions

Open a GitHub Issue — including for questions that aren't yet a concrete change.

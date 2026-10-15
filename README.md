# agboss.dev

[![Deploy](https://github.com/agbossjs/agboss.dev/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/agbossjs/agboss.dev/actions/workflows/deploy.yml)
[![agboss.dev](https://img.shields.io/badge/site-agboss.dev-1d76db)](https://agboss.dev)

Source for the AGBoss documentation site — **[agboss.dev](https://agboss.dev)**.

**AGBoss** is an open-source application framework for building LangGraph agents in TypeScript
("NestJS for LangGraph agents"). The framework itself lives at
[github.com/agbossjs/agboss](https://github.com/agbossjs/agboss); this repository is just the
docs/marketing site that explains and sells it.

Built with [Astro](https://astro.build) + [Starlight](https://starlight.astro.build), deployed to
Firebase Hosting on every push to `main`.

## What's here

- `src/content/docs/getting-started/` — install, first workflow
- `src/content/docs/concepts/` — components, DI, the flow DSL, routing, FinOps
- `src/content/docs/reference/` — API reference
- `src/content/docs/guides/` — task-oriented how-tos
- `src/content/docs/examples/` — one page per task (the main SEO channel)
- `src/components/`, `src/styles/` — the Spring-style homepage and shared layout

## Develop

```bash
npm install
npm run dev       # astro dev, local preview
npm run build      # astro build → dist/
npm run preview    # serve the built site locally
```

## Deploy

Pushes to `main` build and deploy to Firebase Hosting via Workload Identity Federation (no stored
keys — see `.github/workflows/`). Pull requests build only; they never touch GCP.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Code in this repository is licensed under the Apache License 2.0 (see [LICENSE](./LICENSE)).

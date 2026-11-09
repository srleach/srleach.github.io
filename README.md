# seanrleach.co.uk

Personal site and technical blog. Built with [Astro](https://astro.build/) and the
[AstroPaper](https://github.com/satnaing/astro-paper) theme (v7.1.0, MIT, see
`LICENSE-astro-paper`), and deployed to GitHub Pages by `.github/workflows/deploy.yml`.

## Run locally

Needs Node 22.23 or newer and pnpm.

```bash
pnpm install
pnpm dev        # http://localhost:4321
pnpm build      # type-check, build to dist/ and index for search
```

Search only works after a `pnpm build`, which generates the index.

## Where things are

| What | Where |
|---|---|
| Site title, description, socials, feature flags | `astro-paper.config.ts` |
| Home page intro | `src/pages/index.astro` |
| About page | `src/content/pages/about.md` |
| Posts | `src/content/posts/` |
| Static files served as-is (CNAME, the spa decoder, legacy redirects) | `public/` |

## Writing a post

Add a Markdown file to `src/content/posts/`. The file name becomes the URL:
`my-post.md` is served at `/posts/my-post/`.

```yaml
---
title: "Post title"
description: "One-line summary shown in post lists and search results."
pubDatetime: 2026-11-09T12:00:00Z
tags:
  - one
  - two
---
```

Add `featured: true` to pin a post to the top of the home page, or `draft: true` to keep it
out of the build.

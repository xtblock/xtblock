# XTblock public site (GitHub Pages)

Static site: landing page, Operator manual, Developer manual, Release notes, download links.
Pages are generated from `../xtblock-console/src/docs/*.md` and `../RELEASE-NOTES-testnet.md`
(the internal "Release checklist" section is left out of the public release notes).

## Publish
1. Edit `site.config.json`: set `githubRepo` ("owner/repo"), versions, tagline.
2. Rebuild (needs Node and the `marked` package): `npm i marked` then `node tools/build_site.mjs` from this folder.
3. Commit this `site/` folder. In the GitHub repo: Settings, Pages, Source "Deploy from a branch",
   branch `main`, folder `/site` is not offered, so either copy the contents of `site/` into a `docs/` folder
   and choose `/docs`, or use the included workflow `.github/workflows/pages.yml` at the repo root (Settings, Pages, Source: GitHub Actions; recommended).
4. Create a Release for each version and attach the Console installer (it bundles xtcn and xtgw)
   (the Download card links to `releases/latest`).

## Update
Edit the manuals (`XTblock-*-Manual.md`), run the build again, commit, push.

## Before publishing, check
The manuals and release notes become public. They contain no keys, but read them once for internal details you do not want to share.


## The website

`pages/` is a website: every markdown file in it is a page, at the address its path names
(`pages/about.md` is `/about/`). `npm run dev` serves it next to the workbench:

| Address | Serves |
|---|---|
| http://live.localhost:4000/ | the website |
| http://pd.localhost:4000/ | the workbench |

If Safari can't open them, add this line to `/etc/hosts`: `127.0.0.1  live.localhost pd.localhost`.

### Try breaking it

`pages/index.md` places the note component with a `pd-` tag, and its values are checked against the
component's schema before the page is shown. With the website open, change `tone="tip"` to `tone="tips"`
and save: the page shows what is wrong, with the file, line and column. Change it back and the page
returns by itself. How `pd-` tags work:
[placing components](https://github.com/n8design/pattern-dump/blob/main/docs/guide/storefront.md#placing-components).

### Where it lives

| Path | What lives there |
|---|---|
| `pages/` | the pages, in markdown (`pages/` is the website; `src/patterns/pages/`, if you have it, holds page-sized components) |
| `src/patterns/layouts/page/` | the layout every page renders with; its schema is what a page's frontmatter may set |
| `src/patterns/partials/base/` | the frame around every page: header, navigation, footer |
| `src/patterns/partials/head/` | what the skin adds to every page's `<head>` (the icon) |
| `src/patterns/components/note/` | the component the home page shows |
| `pattern-dump.config.ts` | `storefront`: the website's name and footer (`site`), and where it is published |

A page that doesn't exist shows a built-in 404 page; write `pages/404.md` to change it. A page that moved
can forward from its old address (`redirectFrom: [/old/]`), and `index: false` keeps a page out of search
engines. All of it is in the [storefront guide](https://github.com/n8design/pattern-dump/blob/main/docs/guide/storefront.md).

### Build it

`npm run build` writes the website to `site/` and the workbench to `dist/`, built for `/workbench/`. The
website is served from the root of its host, with the workbench copied into it at `/workbench/`, which is
what the GitHub Pages workflow does.

### Publish it

`.github/workflows/pages.yml` publishes both to GitHub Pages on every push to `main`, at a custom domain
or as a project page.

**As a project page** (`https://<owner>.github.io/<repository>/`, no domain needed): in
`pattern-dump.config.ts`, set `storefront.url` to that address, and `storefront.workbenchUrl` and
`build.basePath` to `/<repository>/workbench/`. Then **Settings → Pages → Source:** "GitHub Actions".

**At a custom domain**, once, in the repository on GitHub:

1. **Settings → Pages → Source:** "GitHub Actions".
2. **Settings → Pages → Custom domain:** your domain, then Save. GitHub recommends verifying the domain in
   your account settings first.
3. **DNS:** for an apex domain (`example.com`), `A` records to `185.199.108.153`, `185.199.109.153`,
   `185.199.110.153` and `185.199.111.153`; for a subdomain (`www.example.com`), a `CNAME` record to
   `<your-user>.github.io`, without the repository name.
4. **Enforce HTTPS** in the same settings, once GitHub offers it (it can take up to a day).
5. **`storefront.url`** in `pattern-dump.config.ts`: the same address, for canonical URLs, link previews and
   the sitemap.

The workflow writes no `CNAME` file: with a GitHub Actions deploy, the custom domain is the setting in
step 2. It installs with `npm ci`, so `pattern-dump` must come from the npm registry, not a local file.

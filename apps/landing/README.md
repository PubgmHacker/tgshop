# @tgshop/landing

Marketing landing page for Souldawn Store — Next.js 14 (App Router), Tailwind, Framer Motion.

## OriginKit

The brief asked for UI patterns copy-pasted/adapted from [OriginKit](https://www.originkit.dev/). During
this build `WebFetch` on `https://www.originkit.dev/` (and `https://originkit.dev`) returned **HTTP 403**
for both the automated fetch tool and the search-result summary tool, so the actual component source
could not be retrieved or copied.

Per the fallback instruction in the task, all `components/ui/*` primitives below were **hand-built with
Framer Motion**, using the same *names/patterns* OriginKit is known to offer (per public descriptions of
the library — animated buttons, gradient text, marquees, accordions, scroll reveals), but none of the code
is copied from OriginKit:

- `Container` — layout wrapper (no OriginKit equivalent, plain utility).
- `RevealOnScroll` — scroll-triggered fade/slide-in wrapper, respects `prefers-reduced-motion`.
- `MotionButton` — animated CTA button with hover/tap micro-interactions and gradient variant.
- `AnimatedGradientText` — text-clipped animated gradient headline accent.
- `Marquee` — infinite horizontal scrolling row (used for the payment-method trust bar).
- `GlowCard` — bordered card with hover glow, used for steps/features/products/reviews.
- `Accordion` — single-open FAQ accordion with animated expand/collapse.
- `StickyNav` — fixed header that gains a blurred background on scroll, with mobile slide-down menu.

If/when OriginKit access is restored, these files can be swapped for actual OriginKit exports without
changing any call sites, since section components only import from `components/ui/*` by name.

## Structure

- `app/` — App Router pages: `/` (RU, default locale), `/en/` (EN), `/terms/`, `/privacy/`, `/refund/`,
  plus `sitemap.ts` and `robots.ts`.
- `components/sections/` — one file per landing section (Hero, TrustBar, HowItWorks, Showcase, WhyUs,
  Reviews, Faq, FinalCta, Footer). Sections are plain, composable, and take `copy`/`locale`/data as props,
  so new pages can reuse them or add new sections without touching existing ones.
- `components/ui/` — OriginKit-pattern primitives (see above).
- `components/seo/JsonLd.tsx` — Organization + FAQPage JSON-LD.
- `components/Analytics.tsx` — env-gated Plausible/Umami loader (renders nothing unless
  `NEXT_PUBLIC_ANALYTICS_PROVIDER` + `NEXT_PUBLIC_ANALYTICS_SCRIPT_URL` are set).
- `lib/i18n.ts` — full RU + EN copy for every section, plus the static demo catalog used as an ISR
  fallback.
- `lib/catalog.ts` — fetches `${NEXT_PUBLIC_API_URL}/public/catalog` with `next: { revalidate: 300 }`;
  on any network error, non-200, or schema-invalid response it falls back to the static demo catalog from
  `lib/i18n.ts` so the page renders correctly even if the backend API is down. The showcase section shows a
  small "demo pricing" notice whenever the fallback is used.
- `lib/format.ts` — presentation-only price formatting from integer cents (never used for money math).
- `lib/env.ts` — typed reads of `NEXT_PUBLIC_*` env vars (bot username, API URL, landing URL, analytics).

## Env vars used

- `NEXT_PUBLIC_BOT_USERNAME` — used to build `https://t.me/<BOT_USERNAME>?start=web` deep links.
- `NEXT_PUBLIC_API_URL` — base URL for the public catalog endpoint (`/public/catalog`). If unset, the
  page skips the network call entirely and always renders the demo catalog.
- `NEXT_PUBLIC_LANDING_URL` — canonical site URL for OpenGraph/Twitter/sitemap/robots.
- `NEXT_PUBLIC_ANALYTICS_PROVIDER` — `plausible` | `umami`, unset disables analytics.
- `NEXT_PUBLIC_ANALYTICS_DOMAIN`, `NEXT_PUBLIC_ANALYTICS_SCRIPT_URL` — analytics script config.

These are not present in the repo root `.env.example`; add them there when wiring the landing app into the
shared env if desired. All are optional and have safe fallbacks.

## Notes / assumptions

- `next.config.js` uses `output: 'standalone'` (for the Docker image) rather than static `output: 'export'`,
  because the showcase section performs a real server-side ISR fetch (`revalidate: 300`) against the store
  API, which static export cannot support. The rest of the page is still built to be "static-export
  friendly": every section is a plain server component with no required runtime state, so `output: 'export'`
  could be re-enabled by swapping `getCatalog` for a build-time-only fetch or the static demo data if a
  pure static deploy is ever needed.
- Favicons/OG image are provided as source **SVG only** (`public/favicon.svg`, `public/og-image.svg`,
  `app/icon.svg`). Rasterized PNG sizes (16x16/32x32/180x180 etc.) were not generated because this phase
  does not run builds or image tooling; generate them from the SVG source with an image pipeline (e.g.
  `sharp`, `@vercel/og`, or `sips`) in a later phase if raster favicons are required for a specific
  platform.
- The `/en/` route duplicates the section composition of `/` with `locale: 'en'` and swapped copy; if more
  pages are added later, prefer moving this composition into a shared `<LandingPage locale={...} />`
  section component once there's a second full page to justify the abstraction.
- Money in the demo catalog and `formatPriceCents` is always integer cents, matching the monorepo money
  convention; it is presentation-only demo/fallback data and is never sent to the payments backend.
- Dockerfile assumes a Next.js `standalone` build output and pnpm workspace filtering; it is written to sit
  in the monorepo root build context (`docker build -f apps/landing/Dockerfile .`).

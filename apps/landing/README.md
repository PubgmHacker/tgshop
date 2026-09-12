# @tgshop/landing

Marketing landing page for AI Access Rage — Next.js 14 (App Router), Tailwind, Framer Motion.

The landing primitives are local components built with the project's Tailwind and Framer Motion stack.
They keep interaction details in one place and do not depend on a third-party design kit:

- `Container` — layout wrapper for the landing content.
- `RevealOnScroll` — scroll-triggered fade/slide-in wrapper, respects `prefers-reduced-motion`.
- `MotionButton` — animated CTA link with restrained hover/tap micro-interactions.
- Payment methods are listed once and wrap on narrow screens; reduced motion does not hide any method.
- `GlowCard` — bordered card with a restrained hover state, used for steps/features/products.
- `Accordion` — single-open FAQ accordion with animated expand/collapse.
- `StickyNav` — fixed header that gains a blurred background on scroll, with mobile slide-down menu.

## Structure

- `app/` — App Router pages: `/` (RU, default locale), `/en/` (EN), `/terms/`, `/privacy/`, `/refund/`,
  plus `sitemap.ts` and `robots.ts`.
- `components/sections/` — one file per landing section (Hero, TrustBar, HowItWorks, Showcase, WhyUs,
  Faq, FinalCta, Footer). Sections are plain, composable, and take `copy`/`locale`/data as props,
  so new pages can reuse them or add new sections without touching existing ones.
- `components/ui/` — local interaction and layout primitives (see above).
- `components/seo/JsonLd.tsx` — Organization + FAQPage JSON-LD.
- `components/Analytics.tsx` — env-gated Plausible/Umami loader (renders nothing unless
  `NEXT_PUBLIC_ANALYTICS_PROVIDER` + `NEXT_PUBLIC_ANALYTICS_SCRIPT_URL` are set).
- `lib/i18n.ts` — full RU + EN copy for every section, plus the small static fallback catalog used by ISR
  fallback.
- `lib/catalog.ts` — fetches `${NEXT_PUBLIC_API_URL}/public/catalog` with `next: { revalidate: 300 }`;
  on any network error, non-200, or schema-invalid response it falls back to the static fallback catalog from
  `lib/i18n.ts` so the page renders correctly even if the backend API is down. The showcase section shows a
  small notice whenever the live catalog is unavailable and the real fallback
  catalog is shown.
- `lib/format.ts` — presentation-only price formatting from integer cents (never used for money math).
- `lib/env.ts` — reads of public env vars (bot username, API URL, landing URL, support URL, analytics).

## Env vars used

- `NEXT_PUBLIC_BOT_USERNAME` — used to build `https://t.me/<BOT_USERNAME>?start=web` deep links.
- `NEXT_PUBLIC_SUPPORT_URL` — support URL shown in the footer.
- `NEXT_PUBLIC_API_URL` — base URL for the public catalog endpoint (`/public/catalog`). If unset, the
  page skips the network call entirely and always renders the fallback catalog.
- `NEXT_PUBLIC_LANDING_URL` — canonical site URL for OpenGraph/Twitter/sitemap/robots.
- `NEXT_PUBLIC_ANALYTICS_PROVIDER` — `plausible` | `umami`, unset disables analytics.
- `NEXT_PUBLIC_ANALYTICS_DOMAIN`, `NEXT_PUBLIC_ANALYTICS_SCRIPT_URL` — analytics script config.

The shared `.env.example` documents the public frontend values used by the
landing app. All are optional and have safe fallbacks.

## Notes / assumptions

- `next.config.js` uses `output: 'standalone'` (for the Docker image) rather than static `output: 'export'`,
  because the showcase section performs a real server-side ISR fetch (`revalidate: 300`) against the store
  API, which static export cannot support. The rest of the page is still built to be "static-export
  friendly": every section is a plain server component with no required runtime state, so `output: 'export'`
  could be re-enabled by swapping `getCatalog` for a build-time-only fetch or the static fallback data if a
  pure static deploy is ever needed.
- Favicons/OG image are provided as source **SVG only** (`public/favicon.svg`, `public/og-image.svg`,
  `app/icon.svg`). Rasterized PNG sizes (16x16/32x32/180x180 etc.) were not generated because this phase
  does not run builds or image tooling; generate them from the SVG source with an image pipeline (e.g.
  `sharp`, `@vercel/og`, or `sips`) in a later phase if raster favicons are required for a specific
  platform.
- The `/en/` route duplicates the section composition of `/` with `locale: 'en'` and swapped copy; if more
  pages are added later, prefer moving this composition into a shared `<LandingPage locale={...} />`
  section component once there's a second full page to justify the abstraction.
- Money in the fallback catalog and `formatPriceCents` is always integer cents, matching the monorepo money
  convention; it is presentation-only fallback data and is never sent to the payments backend.
- Dockerfile assumes a Next.js `standalone` build output and pnpm workspace filtering; it is written to sit
  in the monorepo root build context (`docker build -f apps/landing/Dockerfile .`).

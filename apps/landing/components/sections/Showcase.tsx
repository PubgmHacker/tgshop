import { Container } from '../ui/Container'
import { RevealOnScroll } from '../ui/RevealOnScroll'
import { GlowCard } from '../ui/GlowCard'
import Image from 'next/image'
import { brandMarkUrl } from '../../lib/brands'
import { botDeepLink } from '../../lib/env'
import { formatPriceCents } from '../../lib/format'
import type { DemoProduct, LandingCopy, Locale } from '../../lib/i18n'

export function Showcase({
  copy,
  locale,
  products,
  isFallback
}: {
  copy: LandingCopy
  locale: Locale
  products: DemoProduct[]
  isFallback: boolean
}) {
  return (
    <section id="showcase" className="py-20 sm:py-28">
      <Container>
        <RevealOnScroll className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">{copy.showcase.title}</h2>
          <p className="mt-4 text-muted">{copy.showcase.subtitle}</p>
        </RevealOnScroll>

        {isFallback && (
          <p className="mx-auto mt-6 max-w-md text-center text-xs text-muted/80">
            {copy.showcase.fallbackNotice}
          </p>
        )}

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product, index) => {
            const cheapestPlan = product.plans.reduce((min, plan) =>
              plan.priceCents < min.priceCents ? plan : min
            )
            const markUrl = brandMarkUrl(product)

            return (
              <RevealOnScroll key={product.id} delay={(index % 3) * 0.1}>
                <GlowCard className="flex h-full flex-col">
                  <div className="flex items-center justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      {markUrl ? (
                        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 p-1.5 ring-1 ring-white/10">
                          <Image
                            src={markUrl}
                            alt=""
                            fill
                            unoptimized
                            className="object-contain"
                            sizes="28px"
                          />
                        </span>
                      ) : null}
                      <span className="truncate rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-muted">
                        {product.categoryTitle}
                      </span>
                    </div>
                    {cheapestPlan.badge && (
                      <span className="rounded-full bg-accent-gradient px-3 py-1 text-xs font-semibold text-white">
                        {cheapestPlan.badge}
                      </span>
                    )}
                  </div>

                  <h3 className="mt-4 text-lg font-semibold text-white">{product.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">
                    {product.description}
                  </p>

                  <div className="mt-6 flex items-end justify-between border-t border-line pt-5">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted">
                        {copy.showcase.priceFrom}
                      </p>
                      <p className="text-xl font-bold text-white">
                        {formatPriceCents(cheapestPlan.priceCents, locale)}
                        <span className="ml-1 text-sm font-normal text-muted">
                          {cheapestPlan.durationDays
                            ? copy.showcase.perMonth
                            : copy.showcase.lifetime}
                        </span>
                      </p>
                    </div>
                    <a
                      href={botDeepLink(`product_${product.slug ?? product.id}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-accent-to transition-colors hover:text-white"
                    >
                      {copy.showcase.viewInApp} →
                    </a>
                  </div>
                </GlowCard>
              </RevealOnScroll>
            )
          })}
        </div>
      </Container>
    </section>
  )
}

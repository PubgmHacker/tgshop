import { z } from 'zod';
import { API_URL } from './env';
import { type DemoProduct, type LandingCopy } from './i18n';

const planSchema = z.object({
  id: z.string(),
  title: z.string(),
  priceCents: z.number().int(),
  // The API may omit `durationDays` for one-off (non-subscription) plans.
  // Normalise the missing case to `null` here, at the parse boundary, so the
  // rest of the app only ever deals with `number | null` (see `DemoPlan`).
  durationDays: z.number().int().nullable().default(null),
  badge: z.string().optional(),
});

const productSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  categoryTitle: z.string(),
  plans: z.array(planSchema).min(1),
});

const catalogSchema = z.object({
  products: z.array(productSchema),
});

export interface CatalogResult {
  products: DemoProduct[];
  isFallback: boolean;
}

/**
 * Fetches the public product catalog for the showcase section.
 * Uses ISR via `next: { revalidate: 300 }`. On any failure (network error,
 * non-200 response, or invalid payload) it gracefully falls back to the
 * static demo catalog bundled in the locale copy, so the page never breaks
 * or blocks on the API being down.
 */
export async function getCatalog(copy: LandingCopy): Promise<CatalogResult> {
  if (!API_URL) {
    return { products: copy.demoProducts, isFallback: true };
  }

  try {
    const res = await fetch(`${API_URL}/public/catalog`, {
      next: { revalidate: 300 },
      headers: { accept: 'application/json' },
    });

    if (!res.ok) {
      return { products: copy.demoProducts, isFallback: true };
    }

    const json = await res.json();
    const parsed = catalogSchema.safeParse(json);

    if (!parsed.success || parsed.data.products.length === 0) {
      return { products: copy.demoProducts, isFallback: true };
    }

    return { products: parsed.data.products, isFallback: false };
  } catch {
    return { products: copy.demoProducts, isFallback: true };
  }
}

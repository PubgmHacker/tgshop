import type { MetadataRoute } from 'next';
import { LANDING_URL } from '../lib/env';

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ['', 'en', 'terms', 'privacy', 'refund'];

  return routes.map((route) => ({
    url: `${LANDING_URL}/${route ? `${route}/` : ''}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: route === '' ? 1 : 0.6,
  }));
}

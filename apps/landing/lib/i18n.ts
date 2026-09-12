export type Locale = 'ru' | 'en'

export const DEFAULT_LOCALE: Locale = 'ru'
export const LOCALES: Locale[] = ['ru', 'en']

export interface FaqItem {
  question: string
  answer: string
}

export interface StepItem {
  title: string
  description: string
}

export interface WhyUsItem {
  title: string
  description: string
}

export interface LandingPlan {
  id: string
  title: string
  priceCents: number
  durationDays: number | null
  badge?: string
}

export interface LandingProduct {
  promotion?: {
    featured: boolean
    isNew: boolean
    limited: boolean
    summary: { ru: string; en: string }
    accessNote: { ru: string; en: string }
  } | null
  id: string
  slug?: string
  title: string
  description: string
  categoryTitle: string
  imageUrl?: string | null
  plans: LandingPlan[]
}

export interface LandingCopy {
  meta: {
    title: string
    description: string
    ogTitle: string
    ogDescription: string
  }
  nav: {
    brand: string
    links: { label: string; href: string }[]
    cta: string
  }
  hero: {
    headline: string
    headlineAccent: string
    subheadline: string
    ctaPrimary: string
    ctaSecondary: string
  }
  trust: {
    label: string
    items: string[]
  }
  howItWorks: {
    title: string
    subtitle: string
    steps: StepItem[]
  }
  showcase: {
    title: string
    subtitle: string
    fallbackNotice: string
    priceFrom: string
    perMonth: string
    lifetime: string
    viewInApp: string
    currency: string
  }
  whyUs: {
    title: string
    subtitle: string
    items: WhyUsItem[]
  }
  faq: {
    title: string
    subtitle: string
    items: FaqItem[]
  }
  finalCta: {
    title: string
    subtitle: string
    cta: string
  }
  footer: {
    tagline: string
    columns: {
      title: string
      links: { label: string; href: string }[]
    }[]
    legalLinks: { label: string; href: string }[]
    copyright: string
  }
  fallbackProducts: LandingProduct[]
}

const ruCopy: LandingCopy = {
  meta: {
    title: 'AI Access Rage — AI-инструменты в Telegram',
    description:
      'Mirasim и другие AI-инструменты в Telegram: выберите доступный тариф, оплатите CryptoBot, Telegram Stars или с баланса аккаунта.',
    ogTitle: 'AI Access Rage — AI-инструменты в Telegram',
    ogDescription: 'Выберите доступный тариф и оформите заказ прямо в Telegram.'
  },
  nav: {
    brand: 'AI Access Rage',
    links: [
      { label: 'Как это работает', href: '#how-it-works' },
      { label: 'Каталог', href: '#showcase' },
      { label: 'Вопросы', href: '#faq' }
    ],
    cta: 'Открыть в Telegram'
  },
  hero: {
    headline: 'Доступ к AI-инструментам',
    headlineAccent: 'внутри Telegram',
    subheadline:
      'Выберите доступный тариф, оплатите удобным способом и получите инструкции по заказу в чате бота.',
    ctaPrimary: 'Открыть в Telegram',
    ctaSecondary: 'Смотреть каталог',
  },
  trust: {
    label: 'Доступные способы оплаты',
    items: ['CryptoBot', 'Telegram Stars', 'Баланс аккаунта']
  },
  howItWorks: {
    title: 'Покупка проходит в три шага',
    subtitle: 'Каталог, оплата и заказ находятся внутри Telegram.',
    steps: [
      {
        title: 'Выбираете товар',
        description: 'Откройте бота, выберите категорию и подходящий тариф из каталога.'
      },
      {
        title: 'Оплачиваете',
        description: 'Выберите CryptoBot, Telegram Stars или баланс аккаунта.'
      },
      {
        title: 'Получаете данные заказа',
        description: 'После подтверждения оплаты бот показывает статус и инструкции по выдаче.'
      }
    ]
  },
  showcase: {
    title: 'Каталог',
    subtitle: 'Доступные товары и стоимость доступа. Оформление — в Telegram.',
    fallbackNotice: 'Основной каталог сейчас недоступен. Проверьте актуальные наличие и цену в боте.',
    priceFrom: 'от',
    perMonth: '/мес',
    lifetime: 'навсегда',
    viewInApp: 'Открыть в приложении',
    currency: '$'
  },
  whyUs: {
    title: 'Понятный процесс покупки',
    subtitle: 'Способ оплаты, статус заказа и дальнейшие действия собраны в одном месте.',
    items: [
      {
        title: 'Выбор тарифа',
        description: 'У каждого товара показаны доступные планы и цена.'
      },
      {
        title: 'Статус оплаты',
        description: 'После оплаты заказ остаётся доступен в истории.'
      },
      {
        title: 'Ручная выдача',
        description: 'Если товар требует проверки оператором, это указано заранее.'
      },
      {
        title: 'Поддержка',
        description: 'Если возникнет вопрос по заказу, напишите через бота.'
      }
    ]
  },
  faq: {
    title: 'Часто задаваемые вопросы',
    subtitle: 'Если не нашли ответ — напишите в поддержку через бота.',
    items: [
      {
        question: 'Когда я получу доступ?',
        answer:
          'Это зависит от товара и способа выдачи. Статус и инструкции появятся в заказе; для ручной выдачи потребуется проверка оператора.'
      },
      {
        question: 'Какие способы оплаты доступны?',
        answer:
          'Мы принимаем оплату через CryptoBot, Telegram Stars или с баланса аккаунта. Доступные способы показываются при оформлении.'
      },
      {
        question: 'Что делать, если товар не работает?',
        answer:
          'Напишите в поддержку через бота. Мы проверим заказ и подскажем дальнейшие действия по правилам конкретного товара.'
      },
      {
        question: 'Нужна ли регистрация на сайте?',
        answer: 'Нет, всё происходит внутри Telegram — достаточно открыть бота и выбрать товар.'
      },
      {
        question: 'Где посмотреть заказ?',
        answer: 'Статус и детали заказа доступны в разделе заказов миниаппа после оформления.'
      }
    ]
  },
  finalCta: {
    title: 'Откройте каталог в Telegram',
    subtitle:
      'Проверьте товар, выберите тариф и оформите заказ без переходов между сервисами.',
    cta: 'Открыть в Telegram'
  },
  footer: {
    tagline: 'AI-инструменты и заказы внутри Telegram.',
    columns: [
      {
        title: 'Продукт',
        links: [
          { label: 'Как это работает', href: '#how-it-works' },
          { label: 'Каталог', href: '#showcase' }
        ]
      },
      {
        title: 'Поддержка',
        links: [
          { label: 'Вопросы', href: '#faq' },
          { label: 'Бот магазина', href: '__support__' }
        ]
      }
    ],
    legalLinks: [
      { label: 'Условия использования', href: '/terms' },
      { label: 'Политика конфиденциальности', href: '/privacy' },
      { label: 'Политика возврата', href: '/refund' }
    ],
    copyright: 'Все права защищены.'
  },
  fallbackProducts: [
    {
      id: 'mirasim',
      slug: 'mirasim',
      title: 'Mirasim',
      description: 'IDE для agentic coding и eval. Доступ оформляется оператором вручную.',
      categoryTitle: 'Код',
      imageUrl: '/brands/mirasim.png',
      plans: [{ id: 'mirasim-pro-1m', title: '1 месяц', priceCents: 2900, durationDays: 30 }]
    }
  ]
}

const enCopy: LandingCopy = {
  meta: {
    title: 'AI Access Rage — AI tools in Telegram',
    description:
      'Mirasim and other AI tools in Telegram: choose an available plan and pay with CryptoBot, Telegram Stars or account balance.',
    ogTitle: 'AI Access Rage — AI tools in Telegram',
    ogDescription: 'Choose an available plan and place an order directly in Telegram.'
  },
  nav: {
    brand: 'AI Access Rage',
    links: [
      { label: 'How it works', href: '#how-it-works' },
      { label: 'Catalog', href: '#showcase' },
      { label: 'FAQ', href: '#faq' }
    ],
    cta: 'Open in Telegram'
  },
  hero: {
    headline: 'AI tools',
    headlineAccent: 'inside Telegram',
    subheadline:
      'Choose an available plan, pay with a supported method, and get order instructions in the bot chat.',
    ctaPrimary: 'Open in Telegram',
    ctaSecondary: 'Browse catalog',
  },
  trust: {
    label: 'Available payment methods',
    items: ['CryptoBot', 'Telegram Stars', 'Account balance']
  },
  howItWorks: {
    title: 'A clear three-step purchase',
    subtitle: 'The catalog, payment and order status stay inside Telegram.',
    steps: [
      {
        title: 'Choose a product',
        description: 'Open the bot, pick a category and the plan that fits from the catalog.'
      },
      {
        title: 'Pay',
        description: 'Use CryptoBot, Telegram Stars or your account balance.'
      },
      {
        title: 'See your order details',
        description: 'After payment confirmation, the bot shows the status and delivery instructions.'
      }
    ]
  },
  showcase: {
    title: 'Available products',
    subtitle: 'Review the products and plans before opening an order.',
    fallbackNotice: 'The live catalog is currently unavailable. Check the current availability and price in the bot.',
    priceFrom: 'from',
    perMonth: '/mo',
    lifetime: 'lifetime',
    viewInApp: 'Open in app',
    currency: '$'
  },
  whyUs: {
    title: 'A clear purchase process',
    subtitle: 'Payment method, order status and next steps stay in one place.',
    items: [
      {
        title: 'Choose a plan',
        description: 'Each product shows its available plans and price.'
      },
      {
        title: 'Track payment',
        description: 'After payment, the order remains available in your history.'
      },
      {
        title: 'Manual fulfilment is marked',
        description: 'If a product needs an operator review, the flow says so in advance.'
      },
      {
        title: 'Support',
        description: 'If you have a question about an order, contact us through the bot.'
      }
    ]
  },
  faq: {
    title: 'Frequently asked questions',
    subtitle: 'If you cannot find an answer, contact support through the bot.',
    items: [
      {
        question: 'When will I receive access?',
        answer:
          'It depends on the product and fulfilment method. The order shows its status and instructions; manual fulfilment requires an operator review.'
      },
      {
        question: 'What payment methods are available?',
        answer: 'We accept CryptoBot, Telegram Stars or account balance. The available methods are shown during checkout.'
      },
      {
        question: "What if my product doesn't work?",
        answer:
          'Contact support through the bot. We will check the order and explain the next steps under the product rules.'
      },
      {
        question: 'Do I need to sign up on a website?',
        answer: 'No, everything happens inside Telegram — just open the bot and pick a product.'
      },
      {
        question: 'Where can I see my order?',
        answer: 'The miniapp orders section shows the status and details after checkout.'
      }
    ]
  },
  finalCta: {
    title: 'Open the catalog in Telegram',
    subtitle:
      'Review the product, choose a plan and place an order without switching between services.',
    cta: 'Open in Telegram'
  },
  footer: {
    tagline: 'AI tools and orders inside Telegram.',
    columns: [
      {
        title: 'Product',
        links: [
          { label: 'How it works', href: '#how-it-works' },
          { label: 'Catalog', href: '#showcase' }
        ]
      },
      {
        title: 'Support',
        links: [
          { label: 'FAQ', href: '#faq' },
          { label: 'Store bot', href: '__support__' }
        ]
      }
    ],
    legalLinks: [
      { label: 'Terms of Service', href: '/terms' },
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Refund Policy', href: '/refund' }
    ],
    copyright: 'All rights reserved.'
  },
  fallbackProducts: [
    {
      id: 'mirasim',
      slug: 'mirasim',
      title: 'Mirasim',
      description: 'An IDE for agentic coding and eval. Access is set up manually by an operator.',
      categoryTitle: 'Code',
      imageUrl: '/brands/mirasim.png',
      plans: [{ id: 'mirasim-pro-1m', title: '1 month', priceCents: 2900, durationDays: 30 }]
    }
  ]
}

export const COPY: Record<Locale, LandingCopy> = {
  ru: ruCopy,
  en: enCopy
}

export function getCopy(locale: Locale): LandingCopy {
  return COPY[locale] ?? COPY[DEFAULT_LOCALE]
}

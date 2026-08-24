export type Locale = 'ru' | 'en';

export const DEFAULT_LOCALE: Locale = 'ru';
export const LOCALES: Locale[] = ['ru', 'en'];

export interface FaqItem {
  question: string;
  answer: string;
}

export interface ReviewItem {
  name: string;
  handle: string;
  text: string;
  rating: number;
}

export interface StepItem {
  title: string;
  description: string;
}

export interface WhyUsItem {
  title: string;
  description: string;
}

export interface DemoPlan {
  id: string;
  title: string;
  priceCents: number;
  durationDays: number | null;
  badge?: string;
}

export interface DemoProduct {
  id: string;
  title: string;
  description: string;
  categoryTitle: string;
  plans: DemoPlan[];
}

export interface LandingCopy {
  meta: {
    title: string;
    description: string;
    ogTitle: string;
    ogDescription: string;
  };
  nav: {
    brand: string;
    links: { label: string; href: string }[];
    cta: string;
  };
  hero: {
    eyebrow: string;
    headline: string;
    headlineAccent: string;
    subheadline: string;
    ctaPrimary: string;
    ctaSecondary: string;
    stat1Value: string;
    stat1Label: string;
    stat2Value: string;
    stat2Label: string;
    stat3Value: string;
    stat3Label: string;
  };
  trust: {
    label: string;
    items: string[];
  };
  howItWorks: {
    eyebrow: string;
    title: string;
    subtitle: string;
    steps: StepItem[];
  };
  showcase: {
    eyebrow: string;
    title: string;
    subtitle: string;
    fallbackNotice: string;
    priceFrom: string;
    perMonth: string;
    lifetime: string;
    viewInApp: string;
    currency: string;
  };
  whyUs: {
    eyebrow: string;
    title: string;
    subtitle: string;
    items: WhyUsItem[];
  };
  reviews: {
    eyebrow: string;
    title: string;
    subtitle: string;
    items: ReviewItem[];
  };
  faq: {
    eyebrow: string;
    title: string;
    subtitle: string;
    items: FaqItem[];
  };
  finalCta: {
    title: string;
    subtitle: string;
    cta: string;
  };
  footer: {
    tagline: string;
    columns: {
      title: string;
      links: { label: string; href: string }[];
    }[];
    legalLinks: { label: string; href: string }[];
    copyright: string;
  };
  demoProducts: DemoProduct[];
}

const ruCopy: LandingCopy = {
  meta: {
    title: 'AI Access Rage — подписки на нейросети в Telegram',
    description:
      'ChatGPT, Claude, Midjourney и другие модели: оплата картой, USDT TRC-20 или Stars, выдача за секунды, 24/7.',
    ogTitle: 'AI Access Rage — подписки на нейросети',
    ogDescription:
      'Выбирайте модель, оплачивайте любым способом и получайте доступ мгновенно. Работает прямо в Telegram.',
  },
  nav: {
    brand: 'AI Access Rage',
    links: [
      { label: 'Как это работает', href: '#how-it-works' },
      { label: 'Каталог', href: '#showcase' },
      { label: 'Почему мы', href: '#why-us' },
      { label: 'Отзывы', href: '#reviews' },
      { label: 'Вопросы', href: '#faq' },
    ],
    cta: 'Открыть в Telegram',
  },
  hero: {
    eyebrow: 'Подписки на нейросети в Telegram',
    headline: 'Покупки за 30 секунд,',
    headlineAccent: 'доступ сразу',
    subheadline:
      'ChatGPT, Claude, Midjourney — оплата CryptoBot, Telegram Stars или USDT TRC-20. Никаких сайтов, всё в чате бота.',
    ctaPrimary: 'Открыть в Telegram',
    ctaSecondary: 'Смотреть каталог',
    stat1Value: '24/7',
    stat1Label: 'автоматическая доставка',
    stat2Value: '<30с',
    stat2Label: 'среднее время выдачи',
    stat3Value: '3',
    stat3Label: 'способа оплаты',
  },
  trust: {
    label: 'Принимаем оплату',
    items: ['CryptoBot', 'Telegram Stars', 'USDT TRC-20'],
  },
  howItWorks: {
    eyebrow: 'Как это работает',
    title: 'Три шага до получения товара',
    subtitle: 'Никаких форм регистрации и ожидания — всё происходит внутри Telegram.',
    steps: [
      {
        title: 'Выбираете товар',
        description: 'Откройте бота, выберите категорию и подходящий тариф из каталога.',
      },
      {
        title: 'Оплачиваете любым способом',
        description: 'CryptoBot, Telegram Stars или USDT TRC-20 — оплата подтверждается автоматически.',
      },
      {
        title: 'Получаете мгновенно',
        description: 'Бот присылает товар сразу после оплаты — без ожидания менеджера.',
      },
    ],
  },
  showcase: {
    eyebrow: 'Каталог',
    title: 'Популярные модели',
    subtitle: 'Актуальные цены подтягиваются из магазина в реальном времени.',
    fallbackNotice: 'Показаны демонстрационные цены — актуальный каталог смотрите в боте.',
    priceFrom: 'от',
    perMonth: '/мес',
    lifetime: 'навсегда',
    viewInApp: 'Открыть в приложении',
    currency: '₸',
  },
  whyUs: {
    eyebrow: 'Почему мы',
    title: 'Автоматизация, которой можно доверять',
    subtitle: 'Мы построили систему так, чтобы вы получали товар быстрее, чем успеете закрыть чат.',
    items: [
      {
        title: 'Мгновенная доставка',
        description: 'Товар выдаётся автоматически сразу после подтверждения оплаты, без выходных и праздников.',
      },
      {
        title: 'Работаем 24/7',
        description: 'Бот и платежи работают без перерывов — покупайте в любое время суток.',
      },
      {
        title: 'Гарантия и замена',
        description: 'Если товар не работает, мы заменим его или вернём деньги на баланс.',
      },
      {
        title: 'Поддержка на связи',
        description: 'Живая поддержка отвечает в течение часа по любым вопросам с заказом.',
      },
    ],
  },
  reviews: {
    eyebrow: 'Отзывы',
    title: 'Что говорят покупатели',
    subtitle: 'Реальные впечатления от скорости и удобства покупки.',
    items: [
      {
        name: 'Алексей',
        handle: '@alexey_dev',
        text: 'Оплатил Stars и через 10 секунд уже пользовался подпиской. Очень удобно, что всё в Telegram.',
        rating: 5,
      },
      {
        name: 'Марина',
        handle: '@marina_k',
        text: 'Понравилось, что можно платить USDT — никаких проблем с картами. Поддержка ответила быстро.',
        rating: 5,
      },
      {
        name: 'Данияр',
        handle: '@daniyar.b',
        text: 'Купил подряд три тарифа для команды, всё пришло мгновенно на каждый заказ отдельно.',
        rating: 5,
      },
    ],
  },
  faq: {
    eyebrow: 'Вопросы',
    title: 'Часто задаваемые вопросы',
    subtitle: 'Если не нашли ответ — напишите в поддержку прямо из бота.',
    items: [
      {
        question: 'Как быстро я получу товар после оплаты?',
        answer:
          'В большинстве случаев доставка происходит автоматически в течение нескольких секунд после подтверждения оплаты. Для оплат в USDT доставка происходит после нужного числа подтверждений в сети TRON.',
      },
      {
        question: 'Какие способы оплаты доступны?',
        answer: 'Мы принимаем оплату через CryptoBot, Telegram Stars и напрямую USDT в сети TRON (TRC-20).',
      },
      {
        question: 'Что делать, если товар не работает?',
        answer:
          'Напишите в поддержку через бота — мы проверим заказ и либо заменим товар, либо вернём средства на ваш баланс.',
      },
      {
        question: 'Нужна ли регистрация на сайте?',
        answer: 'Нет, всё происходит внутри Telegram — достаточно открыть бота и выбрать товар.',
      },
      {
        question: 'Можно ли оформить подписку на несколько месяцев сразу?',
        answer: 'Да, у каждой модели есть тарифы на 1 и 3 месяца.',
      },
    ],
  },
  finalCta: {
    title: 'Готовы получить свой товар за секунды?',
    subtitle: 'Откройте бота в Telegram и выберите то, что нужно — оплата и доставка займут меньше минуты.',
    cta: 'Открыть в Telegram',
  },
  footer: {
    tagline: 'Подписки на нейросети с мгновенной выдачей прямо в Telegram.',
    columns: [
      {
        title: 'Продукт',
        links: [
          { label: 'Как это работает', href: '#how-it-works' },
          { label: 'Каталог', href: '#showcase' },
          { label: 'Отзывы', href: '#reviews' },
        ],
      },
      {
        title: 'Поддержка',
        links: [
          { label: 'Вопросы', href: '#faq' },
          { label: 'Написать в поддержку', href: '#' },
        ],
      },
    ],
    legalLinks: [
      { label: 'Условия использования', href: '/terms' },
      { label: 'Политика конфиденциальности', href: '/privacy' },
      { label: 'Политика возврата', href: '/refund' },
    ],
    copyright: 'Все права защищены.',
  },
  demoProducts: [
    {
      id: 'demo-chatgpt',
      title: 'ChatGPT Plus',
      description: 'GPT-4o, приоритетный доступ, DALL·E.',
      categoryTitle: 'Чат',
      plans: [
        { id: 'p1', title: '1 месяц', priceCents: 49900, durationDays: 30 },
        { id: 'p2', title: '3 месяца', priceCents: 129900, durationDays: 90, badge: 'Хит' },
      ],
    },
    {
      id: 'demo-midjourney',
      title: 'Midjourney',
      description: 'Генерация изображений в Discord.',
      categoryTitle: 'Картинки',
      plans: [
        { id: 'p3', title: '1 месяц', priceCents: 79900, durationDays: 30 },
        { id: 'p4', title: '3 месяца', priceCents: 199900, durationDays: 90, badge: 'Выгодно' },
      ],
    },
    {
      id: 'demo-cursor',
      title: 'Cursor Pro',
      description: 'Агентный редактор с доступом к моделям.',
      categoryTitle: 'Код',
      plans: [
        { id: 'p5', title: '1 месяц', priceCents: 79900, durationDays: 30 },
        { id: 'p6', title: '3 месяца', priceCents: 199900, durationDays: 90, badge: 'Топ' },
      ],
    },
  ],
};

const enCopy: LandingCopy = {
  meta: {
    title: 'AI Access Rage — neural-net subscriptions in Telegram',
    description:
      'ChatGPT, Claude, Midjourney and other models: pay with card, USDT TRC-20 or Stars, delivered in seconds, 24/7.',
    ogTitle: 'AI Access Rage — neural-net subscriptions',
    ogDescription: 'Pick a model, pay any way you like, get access instantly. Works entirely inside Telegram.',
  },
  nav: {
    brand: 'AI Access Rage',
    links: [
      { label: 'How it works', href: '#how-it-works' },
      { label: 'Catalog', href: '#showcase' },
      { label: 'Why us', href: '#why-us' },
      { label: 'Reviews', href: '#reviews' },
      { label: 'FAQ', href: '#faq' },
    ],
    cta: 'Open in Telegram',
  },
  hero: {
    eyebrow: 'Neural-net subscriptions in Telegram',
    headline: 'Checkout in 30 seconds,',
    headlineAccent: 'access instantly',
    subheadline:
      'ChatGPT, Claude, Midjourney — pay with CryptoBot, Telegram Stars or USDT TRC-20. No websites, everything inside the bot chat.',
    ctaPrimary: 'Open in Telegram',
    ctaSecondary: 'Browse catalog',
    stat1Value: '24/7',
    stat1Label: 'automated delivery',
    stat2Value: '<30s',
    stat2Label: 'average delivery time',
    stat3Value: '3',
    stat3Label: 'payment methods',
  },
  trust: {
    label: 'We accept',
    items: ['CryptoBot', 'Telegram Stars', 'USDT TRC-20'],
  },
  howItWorks: {
    eyebrow: 'How it works',
    title: 'Three steps to get your product',
    subtitle: 'No signup forms, no waiting — everything happens inside Telegram.',
    steps: [
      {
        title: 'Choose a product',
        description: 'Open the bot, pick a category and the plan that fits from the catalog.',
      },
      {
        title: 'Pay any way you like',
        description: 'CryptoBot, Telegram Stars or USDT TRC-20 — payment is confirmed automatically.',
      },
      {
        title: 'Receive instantly',
        description: 'The bot delivers your product right after payment — no waiting for a manager.',
      },
    ],
  },
  showcase: {
    eyebrow: 'Catalog',
    title: 'Popular models',
    subtitle: 'Live prices are pulled straight from the store.',
    fallbackNotice: 'Showing demo pricing — see the live catalog inside the bot.',
    priceFrom: 'from',
    perMonth: '/mo',
    lifetime: 'lifetime',
    viewInApp: 'Open in app',
    currency: '$',
  },
  whyUs: {
    eyebrow: 'Why us',
    title: 'Automation you can trust',
    subtitle: 'We built the system so you get your product faster than you can close the chat.',
    items: [
      {
        title: 'Instant delivery',
        description: 'Products are delivered automatically right after payment is confirmed, no days off.',
      },
      {
        title: '24/7 automation',
        description: 'The bot and payments run around the clock — buy at any time of day or night.',
      },
      {
        title: 'Warranty & replacement',
        description: "If a product doesn't work, we'll replace it or refund it to your balance.",
      },
      {
        title: 'Support on standby',
        description: 'Live support replies within an hour for any order-related questions.',
      },
    ],
  },
  reviews: {
    eyebrow: 'Reviews',
    title: 'What customers say',
    subtitle: 'Real feedback about speed and convenience.',
    items: [
      {
        name: 'Alex',
        handle: '@alexey_dev',
        text: 'Paid with Stars and was using the subscription 10 seconds later. Love that everything is in Telegram.',
        rating: 5,
      },
      {
        name: 'Marina',
        handle: '@marina_k',
        text: "Loved being able to pay in USDT — no card hassle at all. Support replied fast too.",
        rating: 5,
      },
      {
        name: 'Daniyar',
        handle: '@daniyar.b',
        text: 'Bought three plans in a row for my team, each one arrived instantly and separately.',
        rating: 5,
      },
    ],
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Frequently asked questions',
    subtitle: "Can't find an answer? Message support right from the bot.",
    items: [
      {
        question: 'How fast will I get my product after paying?',
        answer:
          'In most cases delivery happens automatically within seconds of payment confirmation. USDT payments are delivered once the required number of TRON network confirmations is reached.',
      },
      {
        question: 'What payment methods are available?',
        answer: 'We accept CryptoBot, Telegram Stars, and direct USDT on the TRON network (TRC-20).',
      },
      {
        question: "What if my product doesn't work?",
        answer:
          "Message support through the bot — we'll check the order and either replace the product or refund it to your balance.",
      },
      {
        question: 'Do I need to sign up on a website?',
        answer: 'No, everything happens inside Telegram — just open the bot and pick a product.',
      },
      {
        question: 'Can I subscribe for several months at once?',
        answer: 'Yes — each model has 1-month and 3-month plans.',
      },
    ],
  },
  finalCta: {
    title: 'Ready to get your product in seconds?',
    subtitle: 'Open the bot in Telegram and pick what you need — payment and delivery take less than a minute.',
    cta: 'Open in Telegram',
  },
  footer: {
    tagline: 'Neural-net subscriptions with instant delivery, right inside Telegram.',
    columns: [
      {
        title: 'Product',
        links: [
          { label: 'How it works', href: '#how-it-works' },
          { label: 'Catalog', href: '#showcase' },
          { label: 'Reviews', href: '#reviews' },
        ],
      },
      {
        title: 'Support',
        links: [
          { label: 'FAQ', href: '#faq' },
          { label: 'Contact support', href: '#' },
        ],
      },
    ],
    legalLinks: [
      { label: 'Terms of Service', href: '/terms' },
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Refund Policy', href: '/refund' },
    ],
    copyright: 'All rights reserved.',
  },
  demoProducts: [
    {
      id: 'demo-chatgpt',
      title: 'ChatGPT Plus',
      description: 'GPT-4o, priority access, DALL·E.',
      categoryTitle: 'Chat',
      plans: [
        { id: 'p1', title: '1 month', priceCents: 999, durationDays: 30 },
        { id: 'p2', title: '3 months', priceCents: 2699, durationDays: 90, badge: 'Popular' },
      ],
    },
    {
      id: 'demo-midjourney',
      title: 'Midjourney',
      description: 'Image generation in Discord.',
      categoryTitle: 'Images',
      plans: [
        { id: 'p3', title: '1 month', priceCents: 1599, durationDays: 30 },
        { id: 'p4', title: '3 months', priceCents: 3999, durationDays: 90, badge: 'Best value' },
      ],
    },
    {
      id: 'demo-cursor',
      title: 'Cursor Pro',
      description: 'Agentic editor with model access.',
      categoryTitle: 'Code',
      plans: [
        { id: 'p5', title: '1 month', priceCents: 1599, durationDays: 30 },
        { id: 'p6', title: '3 months', priceCents: 3999, durationDays: 90, badge: 'Top pick' },
      ],
    },
  ],
};

export const COPY: Record<Locale, LandingCopy> = {
  ru: ruCopy,
  en: enCopy,
};

export function getCopy(locale: Locale): LandingCopy {
  return COPY[locale] ?? COPY[DEFAULT_LOCALE];
}

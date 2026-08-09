import type { Metadata } from 'next';
import { Container } from '../../components/ui/Container';
import { StickyNav } from '../../components/ui/StickyNav';
import { Footer } from '../../components/sections/Footer';
import { getCopy } from '../../lib/i18n';
import { botDeepLink } from '../../lib/env';

const copy = getCopy('ru');

export const metadata: Metadata = {
  title: 'Условия использования',
};

export default function TermsPage() {
  const botLink = botDeepLink('web');

  return (
    <main>
      <StickyNav
        brand={copy.nav.brand}
        links={copy.nav.links}
        ctaLabel={copy.nav.cta}
        ctaHref={botLink}
        localeSwitcherHref="/en/terms/"
        localeSwitcherLabel="EN"
      />
      <Container className="max-w-3xl pt-32 pb-20 sm:pt-40">
        <h1 className="text-3xl font-bold text-white sm:text-4xl">Условия использования</h1>
        <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted">
          <p>
            Используя бота и мини-приложение Souldawn Store («Сервис»), вы соглашаетесь с настоящими условиями.
            Сервис предоставляет доступ к цифровым товарам и подпискам, оплата и доставка которых происходят
            автоматически внутри Telegram.
          </p>
          <p>
            Все цены указаны в валюте, отображённой в каталоге, и могут изменяться без предварительного уведомления.
            Оплаченный заказ считается исполненным с момента доставки цифрового товара в чат бота или на баланс
            пользователя.
          </p>
          <p>
            Пользователь обязуется не использовать Сервис для незаконной деятельности, передачи прав третьим лицам в
            нарушение лицензий поставщиков цифровых товаров, а также не пытаться обойти механизмы защиты платежей.
          </p>
          <p>
            Мы оставляем за собой право заблокировать доступ пользователю в случае выявления мошеннических действий,
            чарджбэков или нарушения настоящих условий.
          </p>
          <p>По вопросам, связанным с условиями использования, обращайтесь в поддержку через бота.</p>
        </div>
      </Container>
      <Footer copy={copy} />
    </main>
  );
}

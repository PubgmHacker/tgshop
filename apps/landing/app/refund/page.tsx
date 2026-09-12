import type { Metadata } from 'next';
import { Container } from '../../components/ui/Container';
import { StickyNav } from '../../components/ui/StickyNav';
import { Footer } from '../../components/sections/Footer';
import { getCopy } from '../../lib/i18n';
import { botDeepLink } from '../../lib/env';

const copy = getCopy('ru');

export const metadata: Metadata = {
  title: 'Политика возврата',
};

export default function RefundPage() {
  const botLink = botDeepLink('web');

  return (
    <main>
      <StickyNav
        brand={copy.nav.brand}
        links={copy.nav.links.map((link) => ({ ...link, href: `/${link.href}` }))}
        ctaLabel={copy.nav.cta}
        ctaHref={botLink}
        localeSwitcherHref="/en/"
        localeSwitcherLabel="EN"
      />
      <Container className="max-w-3xl pt-32 pb-20 sm:pt-40">
        <h1 className="break-words text-2xl font-bold text-white [overflow-wrap:anywhere] sm:text-4xl">Политика возврата</h1>
        <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted">
          <p>
            Если доставленный цифровой товар не работает или не соответствует описанию, напишите в поддержку через
            бота в течение 48 часов с указанием номера заказа.
          </p>
          <p>
            После проверки заказа мы либо заменим товар аналогичным рабочим экземпляром, либо вернём уплаченную
            сумму на внутренний баланс вашего аккаунта, либо, если это невозможно, инициируем возврат через
            платёжного провайдера в соответствии с его правилами.
          </p>
          <p>
            Возврат не производится, если товар был использован не по назначению, доступ был передан третьим лицам
            в нарушение условий использования, либо истёк установленный срок обращения.
          </p>
          <p>
            Для оплат криптовалютой и Telegram Stars возврат осуществляется на баланс аккаунта в Сервисе; прямой
            возврат криптовалюты на исходный адрес может быть невозможен по техническим причинам сети.
          </p>
        </div>
      </Container>
      <Footer copy={copy} />
    </main>
  );
}

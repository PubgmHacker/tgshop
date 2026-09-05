import type { Metadata } from 'next';
import { Container } from '../../components/ui/Container';
import { StickyNav } from '../../components/ui/StickyNav';
import { Footer } from '../../components/sections/Footer';
import { getCopy } from '../../lib/i18n';
import { botDeepLink } from '../../lib/env';

const copy = getCopy('ru');

export const metadata: Metadata = {
  title: 'Политика конфиденциальности',
};

export default function PrivacyPage() {
  const botLink = botDeepLink('web');

  return (
    <main>
      <StickyNav
        brand={copy.nav.brand}
        links={copy.nav.links}
        ctaLabel={copy.nav.cta}
        ctaHref={botLink}
        localeSwitcherHref="/en/privacy/"
        localeSwitcherLabel="EN"
      />
      <Container className="max-w-3xl pt-32 pb-20 sm:pt-40">
        <h1 className="text-3xl font-bold text-white sm:text-4xl">Политика конфиденциальности</h1>
        <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted">
          <p>
            Мы обрабатываем минимально необходимый набор данных: ваш Telegram ID, имя пользователя, язык интерфейса и
            историю заказов, чтобы обеспечить доставку цифровых товаров и работу поддержки.
          </p>
          <p>
            Платёжные данные обрабатываются провайдерами оплаты (CryptoBot, Telegram) — мы не храним
            номера карт и приватные ключи криптокошельков пользователей.
          </p>
          <p>
            Данные хранятся в защищённой базе данных, доступ к которой ограничен ролями администраторов Сервиса.
            Конфиденциальные полезные нагрузки товаров хранятся в зашифрованном виде.
          </p>
          <p>
            Мы не передаём персональные данные третьим лицам, за исключением случаев, необходимых для обработки
            платежей или требований законодательства.
          </p>
          <p>
            Вы можете запросить удаление своих данных, написав в поддержку через бота — за исключением данных,
            необходимых для соблюдения финансовой и налоговой отчётности.
          </p>
        </div>
      </Container>
      <Footer copy={copy} />
    </main>
  );
}

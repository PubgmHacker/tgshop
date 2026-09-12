# Security и качество — аудит 12 сентября 2026

Аудит выполнен после релиза `09ce5e000ee6af4ebfa88e2cb652689afd1aa99d`.

## Исправлено

- Убраны резервные ветки `Math.random()` из клиентских idempotency-ключей.
  Теперь используется `crypto.randomUUID()` или `crypto.getRandomValues()`;
  при отсутствии безопасного источника операция останавливается.
- Корреляционные идентификаторы bot error handler генерируются через
  `node:crypto.randomBytes`.
- Перемешивание TRON invoice tags использует `randomInt`, сохраняя равномерное
  распределение без слабого PRNG.
- Mini App, admin Mini App, desktop admin и landing получают базовые заголовки:
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy: no-referrer`, ограниченный `Permissions-Policy`.
  CSP не добавлялся без инвентаризации внешних ресурсов: в приложении есть
  Telegram Login Widget, inline theme bootstrap и внешние платёжные переходы.
- Нижняя навигация обоих Mini Apps получила `aria-label`; внешняя платёжная
  fallback-ссылка добавляет `noreferrer`.

## Проверено

- CORS ограничен production origin-ами; webhook paths исключены из общего
  IP rate limit и защищаются собственным secret/HMAC механизмом.
- Helmet, `nosniff`, HSTS, frame policy и referrer policy подтверждены на bot
  production HTTP-ответе.
- Административные API без токена отвечают 401; production `/api/auth/dev`
  отвечает 404. Admin session cookie: HttpOnly, Secure в production,
  SameSite=Lax, подписан HMAC и проверяет expiry.
- Telegram initData проходит серверную HMAC-проверку; причины отказа не
  раскрываются клиенту. Supplier credentials не попадают в клиентские DTO или audit diff.
- Платёжные URL валидируются как HTTPS без username/password; Telegram-ссылки
  открываются через SDK, fallback использует `noopener,noreferrer`.
- `pnpm audit --prod --audit-level=high`: известных уязвимостей нет.
- Core: 173 теста. Bot: 83 теста. TypeScript и lint затронутых приложений прошли.

## Ограничения

- Полный CSP требует перечня доменов Telegram Widget, платёжных провайдеров,
  аналитики и nonce для inline bootstrap; его нельзя безопасно включать вслепую.
- Реальное списание денег и Telegram WebView с физического устройства не
  выполнялись в рамках этого аудита.
- Production database не изменялась; пользовательские данные и платежи не
  создавались.

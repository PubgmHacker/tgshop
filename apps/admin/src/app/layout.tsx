import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'tgshop admin',
  description: 'Admin dashboard for the tgshop Telegram digital-goods store'
}

const NO_FLASH_SCRIPT = `
try {
  var t = localStorage.getItem('tgshop-admin-theme');
  if (t === 'dark') document.documentElement.classList.add('dark');
} catch (e) {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        {/* Inline, blocking on purpose: applies the stored theme before first paint so dark mode never flashes white. Content is a constant, never user input. */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}

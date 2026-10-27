import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { LightboxProvider } from '@/components/lightbox/LightboxProvider';
import { MESSAGES } from '@/lib/messages';
import { PREFERENCES_BOOT_SCRIPT, THEME_COLORS } from '@/lib/preferences.const';
import './globals.css';

const geist = Geist({ subsets: ['latin', 'cyrillic'], variable: '--font-geist' });
const geistMono = Geist_Mono({ subsets: ['latin', 'cyrillic'], variable: '--font-geist-mono' });

// <title> рендерит Preferences на выбранном языке (React поднимает его в <head>)
export const metadata: Metadata = { description: MESSAGES.ru.meta.description };

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // lang и data-theme меняет скрипт ниже до гидрации — расхождение с серверной разметкой ожидаемо
    <html lang="ru" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFERENCES_BOOT_SCRIPT }} />
      </head>
      <body>
        <LightboxProvider>{children}</LightboxProvider>
      </body>
    </html>
  );
}

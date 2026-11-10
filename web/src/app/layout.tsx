import { OwnerTestBanner } from '@/core/OwnerTestBanner';
import type { Metadata } from "next";
import { Bricolage_Grotesque, Onest } from "next/font/google";
import { cookies } from "next/headers";
import { readTheme, THEME_COOKIE } from "@/core/theme/theme";
import { SITE } from "@/core/config";
import { siteOrigin } from "@/core/site-origin";
import { getI18n } from "@/core/i18n/server";
import { publicMessages } from "@/core/i18n/messages";
import { I18nProvider } from "@/core/i18n/I18nProvider";
import "./globals.css";

const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz"], // the canvas loads opsz 12..96: large headings use the narrower optical size
});

const body = Onest({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: await siteOrigin(),
    title: { default: SITE.name, template: '%s · ' + SITE.name },
    twitter: { card: 'summary_large_image' },
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { locale, messages } = await getI18n();
  const choice = readTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang={locale}
      data-theme={choice === "system" ? undefined : choice}
      className={`${display.variable} ${body.variable}`}
    >
      <body className="min-h-screen">
        <I18nProvider locale={locale} messages={publicMessages(messages)}>
          <OwnerTestBanner />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}

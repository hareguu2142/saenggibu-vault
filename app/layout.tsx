import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000",
  ),
  title: "기록담 | 생활기록부 공유",
  description: "학생과 교사가 안전하게 생활기록부를 확인하고 관리하는 공간",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "기록담",
    description: "나의 성장을 기록하는 공간",
    images: [{ url: "/og.png", width: 1734, height: 909, alt: "기록담 생활기록부 공유 공간" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "기록담",
    description: "나의 성장을 기록하는 공간",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}

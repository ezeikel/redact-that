import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from '@vercel/analytics/react';
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RedactThat - AI-Powered Image Redaction Tool | Free Online Document Privacy Protection",
  description: "Instantly redact sensitive information from images with AI. Upload photos of documents, IDs, or forms to automatically detect and black out personal data like names, addresses, phone numbers. Free, secure, browser-based redaction tool.",
  keywords: [
    "image redaction",
    "AI redaction tool", 
    "document privacy protection",
    "photo redaction",
    "automatic PII detection",
    "sensitive information removal",
    "free redaction software",
    "online redaction tool",
    "OCR redaction",
    "HIPAA compliance redaction",
    "legal document redaction",
    "personal data protection",
    "image privacy tool",
    "automated document redaction",
    "smart redaction",
    "picture redaction",
    "photo privacy protection"
  ],
  authors: [{ name: "RedactThat" }],
  creator: "RedactThat",
  publisher: "RedactThat",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://redactthat.com",
    siteName: "RedactThat",
    title: "RedactThat - AI-Powered Image Redaction Tool",
    description: "Free AI-powered tool to automatically detect and redact sensitive information from images. Upload any document photo and protect your privacy instantly.",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "RedactThat - AI Image Redaction Tool",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "RedactThat - AI-Powered Image Redaction Tool",
    description: "Free AI tool to automatically redact sensitive information from images. Upload document photos and protect your privacy instantly.",
    images: ["/twitter-image.png"],
    creator: "@redactthat",
  },
  metadataBase: new URL("https://redactthat.com"),
  alternates: {
    canonical: "/",
  },
  category: "Technology",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Analytics />
      </body>
    </html>
  );
}

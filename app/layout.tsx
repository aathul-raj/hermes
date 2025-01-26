import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hermes",
  description: "AI customer service bots. Built by Athul Suresh for TAMUHACK25.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Inter, Poppins, Roboto_Slab, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "./components/toast/ToastProvider";
import { ConfirmProvider } from "./components/confirm/ConfirmProvider";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

// Extra typefaces the client admin can pick in Appearance. Each is exposed as a
// CSS variable on <html>; the chosen one is applied to the client shell.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-poppins",
});
const robotoSlab = Roboto_Slab({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-slab",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono-custom",
});

export const metadata: Metadata = {
  title: "CRM",
  description: "CRM portal login",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${poppins.variable} ${robotoSlab.variable} ${jetbrainsMono.variable} h-full`}>
      <body className="min-h-full font-sans antialiased">
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}

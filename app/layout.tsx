import "./globals.css";

// app/layout.js
export const metadata = {
  title: "SVANS",
  description: "Your AI Guide for Anything",
  icons: {
    // This looks for public/icon.png
    icon: "/icon.png",
    // This looks for public/apple-touch-icon.png
    apple: "/apple-touch-icon.png",
  },
};
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

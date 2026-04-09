import "./globals.css";

export const metadata = {
  title: "SVANS-AI",
  description: "Your AI Guide for Anything",
  icons: {
    icon: "/sv-bot.png",
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

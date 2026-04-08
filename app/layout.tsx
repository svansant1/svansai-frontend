import "./globals.css";

export const metadata = {
  title: "SVANSAI Parent",
  description: "SVANSAI AI parent app",
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

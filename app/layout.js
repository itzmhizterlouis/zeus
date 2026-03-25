import "./globals.css";

export const metadata = {
  title: "Zescrow | Escrow for premium phone sales",
  description:
    "A minimalist escrow platform for high-value peer-to-peer transactions with verification, delivery, and dispute handling in one flow.",
  icons: {
    icon: "/images/zescrow-logo.svg",
    shortcut: "/images/zescrow-logo.svg",
    apple: "/images/zescrow-logo.svg",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="ambient ambient-green" />
        <div className="ambient ambient-blue" />
        <div className="ambient ambient-pink" />
        {children}
      </body>
    </html>
  );
}

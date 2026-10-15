import type { ReactNode } from "react";

export const metadata = {
  title: "TIK College Portal",
  description: "TIK College оқу порталы",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="kk">
      <body>{children}</body>
    </html>
  );
}

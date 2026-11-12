import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job Hunter — a careful job-search assistant",
  description:
    "Job Hunter discovers relevant remote vacancies daily, explains every match, tailors an evidence-grounded resume, and never applies without your explicit approval.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

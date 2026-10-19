import { SiteHeader } from "@/components/site-header";

/** Every screen of the app shares the header; the landing page at / has its own. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      {children}
    </>
  );
}

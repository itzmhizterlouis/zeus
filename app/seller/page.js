import { redirect } from "next/navigation";
import SellerAccess from "../../components/SellerAccess";
import SiteNav from "../../components/SiteNav";
import { getCurrentSeller } from "../../lib/server/seller-auth";

export const metadata = {
  title: "Seller Access | Zescrow",
};

export const dynamic = "force-dynamic";

export default async function SellerPage({ searchParams }) {
  const seller = await getCurrentSeller();
  const params = await searchParams;
  const mode = params?.mode === "login" ? "login" : "signup";

  if (seller?.onboardingCompleted) {
    redirect("/seller/dashboard");
  }

  return (
    <main className="site-shell">
      <SiteNav
        actions={[
          {
            href: mode === "login" ? "/seller" : "/seller?mode=login",
            label: mode === "login" ? "Sign up as vendor" : "Vendor login",
            variant: "dark",
          },
        ]}
      />
      <section className="section-card page-intro">
        <span className="eyebrow accent-green">Seller onboarding</span>
        <h1>
          {mode === "login"
            ? "Log in to your vendor account."
            : "Create, verify, and unlock the vendor dashboard."}
        </h1>
        <p>
          The seller flow is now cleaner: account setup, contact verification,
          payout setup, and then access to the protected dashboard.
        </p>
      </section>
      <SellerAccess initialMode={mode} initialSeller={seller} />
    </main>
  );
}

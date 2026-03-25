import { redirect } from "next/navigation";
import SellerWorkspace from "../../../components/SellerWorkspace";
import SiteNav from "../../../components/SiteNav";
import { listDisputesForSeller } from "../../../lib/server/disputes";
import { getAppBaseUrl } from "../../../lib/server/env";
import { getCurrentSeller } from "../../../lib/server/seller-auth";
import { listTransactionsForSeller } from "../../../lib/server/transactions";

export const metadata = {
  title: "Seller Dashboard | Zescrow",
};

export const dynamic = "force-dynamic";

export default async function SellerDashboardPage() {
  const seller = await getCurrentSeller();

  if (!seller) {
    redirect("/seller");
  }

  if (!seller.onboardingCompleted) {
    redirect("/seller");
  }

  const transactions = await listTransactionsForSeller(seller.id);
  const disputes = await listDisputesForSeller(seller.id);
  const appBaseUrl = getAppBaseUrl();

  return (
    <main className="site-shell">
      <SiteNav homeHref="/seller/dashboard" />
      <SellerWorkspace
        appBaseUrl={appBaseUrl}
        initialDisputes={disputes}
        initialTransactions={transactions}
        seller={seller}
      />
    </main>
  );
}

import { notFound } from "next/navigation";
import BuyerCheckout from "../../../components/BuyerCheckout";
import SiteNav from "../../../components/SiteNav";
import { getCheckoutStateBySlug } from "../../../lib/server/checkout";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const checkoutState = await getCheckoutStateBySlug(slug);
  const transaction = checkoutState?.transaction;

  if (!transaction) {
    return { title: "Transaction not found | Zescrow" };
  }

  return {
    title: `${transaction.productName} | Zescrow Checkout`,
  };
}

export default async function PaymentPage({ params, searchParams }) {
  const { slug } = await params;
  const checkoutState = await getCheckoutStateBySlug(slug);
  const query = await searchParams;
  const merchantReference = String(query?.merchantReference || "").trim();

  if (!checkoutState) {
    notFound();
  }

  return (
    <main className="site-shell">
      <SiteNav />
      <section className="section-card page-intro">
        <span className="eyebrow accent-blue">Buyer payment link</span>
        <h1>Review the item, verify identity, and pay into escrow.</h1>
        <p>
          The buyer experience should feel reassuring: see everything first,
          verify smoothly, then pay with full clarity on protection.
        </p>
      </section>
      <BuyerCheckout
        initialCheckoutState={checkoutState}
        initialMerchantReference={merchantReference}
      />
    </main>
  );
}

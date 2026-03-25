import Link from "next/link";
import SiteNav from "../components/SiteNav";

const journeySteps = [
  {
    title: "Create your vendor account",
    copy: "Set up your seller profile, verify your contact details, and finish payout setup.",
  },
  {
    title: "Start a protected transaction",
    copy: "Enter the product, price, pickup point, and destination from one focused workspace.",
  },
  {
    title: "Complete the escrow sale",
    copy: "The buyer pays into escrow and funds release only after acceptance or dispute review.",
  },
];

const trustBlocks = [
  {
    title: "Escrow first",
    copy: "Money stays protected until the buyer confirms the device is right.",
  },
  {
    title: "Verified vendors",
    copy: "Seller onboarding includes contact verification, identity setup, and payout details before selling begins.",
  },
  {
    title: "Delivery in one flow",
    copy: "Pickup, destination, and handoff details live inside the same transaction instead of outside it.",
  },
];

export default function HomePage() {
  return (
    <main className="site-shell">
      <SiteNav
        actions={[
          { href: "/seller", label: "Sign up as vendor", variant: "dark" },
          { href: "/seller?mode=login", label: "Vendor login", variant: "light" },
        ]}
      />

      <section className="hero section-card">
        <div className="hero-copy">
          <span className="eyebrow accent-green">Escrow for premium phone sales</span>
          <h1>High-value phone sales should feel clear and protected.</h1>
          <p className="hero-text">
            Zescrow is a web platform for vendor-led escrow transactions. Sellers
            create a verified account, start a sale, and move buyers into a
            secure checkout without marketplace noise.
          </p>
          <div className="button-row">
            <Link className="button button-dark" href="/seller">
              Sign up as vendor
            </Link>
            <Link className="button button-light" href="/seller?mode=login">
              Vendor login
            </Link>
          </div>
        </div>

        <div className="hero-stage">
          <div className="stage-card stage-primary">
            <span className="eyebrow accent-blue">Vendor flow</span>
            <h2 className="hero-card-title">What the platform gives a seller</h2>
            <div className="hero-list">
              <div className="hero-list-item">
                <strong>Clean onboarding</strong>
                <p>Create an account, verify details, and finish payout setup in one place.</p>
              </div>
              <div className="hero-list-item">
                <strong>Simple transaction creation</strong>
                <p>Add the item, the price, and the delivery route without fake dashboard noise.</p>
              </div>
              <div className="hero-list-item">
                <strong>Protected release rules</strong>
                <p>Funds stay in escrow until the buyer accepts the product or a dispute is resolved.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-card split-section">
        <div className="section-heading">
          <span className="eyebrow accent-blue">How it works</span>
          <h2>One direct path from vendor setup to escrow payment.</h2>
          <p>
            The product stays intentionally narrow: verify the vendor, create
            the transaction, and let the buyer complete a protected checkout.
          </p>
        </div>
        <div className="journey-grid">
          {journeySteps.map((step) => (
            <article className="journey-card" key={step.title}>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-card">
        <div className="section-heading">
          <span className="eyebrow accent-green">Core principles</span>
          <h2>Kept simple on purpose.</h2>
          <p>
            The interface is meant to stay quiet and direct so sellers can focus
            on getting verified and starting a protected sale.
          </p>
        </div>
        <div className="journey-grid">
          {trustBlocks.map((item) => (
            <article className="journey-card" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="closing-banner">
        <div>
          <span className="eyebrow accent-blue">Start here</span>
          <h2>Create a vendor account or log back in.</h2>
        </div>
        <div className="button-row">
          <Link className="button button-dark" href="/seller">
            Sign up as vendor
          </Link>
          <Link className="button button-light" href="/seller?mode=login">
            Vendor login
          </Link>
        </div>
      </section>
    </main>
  );
}

import AdminDesk from "../../components/AdminDesk";
import SiteNav from "../../components/SiteNav";
import { listDisputes } from "../../lib/server/disputes";

export const metadata = {
  title: "Admin Desk | Zescrow",
};

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const disputes = await listDisputes();

  return (
    <main className="site-shell">
      <SiteNav homeHref="/admin" />
      <section className="section-card page-intro">
        <span className="eyebrow accent-pink">Admin desk</span>
        <h1>Disputes should be reviewable, auditable, and fair.</h1>
        <p>
          Admins need evidence, timelines, and clear release rules without ever
          directly editing ledger history.
        </p>
      </section>
      <AdminDesk initialDisputes={disputes} />
    </main>
  );
}

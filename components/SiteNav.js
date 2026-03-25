import Image from "next/image";
import Link from "next/link";

export default function SiteNav({ actions = [], homeHref = "/" }) {
  return (
    <nav className="site-nav">
      <Link className="brand-mark" href={homeHref}>
        <Image
          alt="Zescrow"
          className="brand-logo-image"
          height={320}
          priority
          src="/images/zescrow-logo.svg"
          width={520}
        />
      </Link>

      <div className="nav-actions">
        {actions.map((action) => (
          <Link
            className={`button ${action.variant === "dark" ? "button-dark" : "button-light"} nav-action-button`}
            href={action.href}
            key={`${action.href}-${action.label}`}
          >
            {action.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

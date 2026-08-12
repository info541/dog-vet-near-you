import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { NavSearch } from "@/components/NavSearch";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-wrap header-inner">
        <Link href="/" className="brand">
          <BrandMark />
          <span className="brand-text">Dog Vet Near You</span>
        </Link>
        <NavSearch />
        <nav className="header-nav" aria-label="Primary">
          <Link href="/ca">California</Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-wrap footer-inner">
        <div className="footer-top">
          <Link href="/" className="footer-brand">
            Dog Vet Near You
          </Link>
          <nav className="footer-links" aria-label="Footer">
            <Link href="/">Home</Link>
            <Link href="/ca">California</Link>
            <a href="mailto:hello@pawharbor.directory">Suggest a clinic</a>
          </nav>
        </div>
        <div className="footer-bottom">
          <p>Dog vets by city. Emergency care shown first.</p>
          <p>
            Call ahead for emergencies and current hours. Info comes from
            public clinic and map data.
          </p>
        </div>
      </div>
    </footer>
  );
}

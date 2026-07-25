"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const KEY = "za_cookie_consent";

/** Bannière de consentement cookies (stockée en localStorage). */
export function CookieBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try { if (!localStorage.getItem(KEY)) setShow(true); } catch { /* SSR / privé */ }
  }, []);

  const decide = (value: "accepted" | "declined") => {
    try { localStorage.setItem(KEY, value); } catch { /* ignore */ }
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="cookie-banner fade-up" role="dialog" aria-label="Consentement aux cookies">
      <p>
        Nous utilisons des cookies essentiels au fonctionnement du site et à votre session.
        En continuant, vous acceptez notre usage des cookies.{" "}
        <Link href="/blog" className="link">En savoir plus</Link>.
      </p>
      <div className="cookie-actions">
        <button className="btn btn-ghost press" style={{ padding: ".5rem 1rem" }} onClick={() => decide("declined")}>
          Refuser
        </button>
        <button className="btn btn-primary press" style={{ padding: ".5rem 1.1rem" }} onClick={() => decide("accepted")}>
          Accepter
        </button>
      </div>
    </div>
  );
}

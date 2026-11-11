/**
 * The iRIS mark, as supplied (the IRIS Corporate Identity Guidelines' secondary lockup: the mark
 * alone). The tagline is part of the primary lockup's own artwork and is never set as text beside
 * the mark; until that artwork is supplied, the mark alone is used. The dark theme shows the reverse
 * mark in IRIS Oat.
 */
export default function BrandLockup({ className = "" }: { className?: string }) {
  return (
    <svg className={`lockup ${className}`} viewBox="0 0 323 205" role="img" aria-label="iRIS">
      <image className="lockup-mark lockup-light" href="/brand/iris-logo.png" width="323" height="205" />
      <image className="lockup-mark lockup-dark" href="/brand/iris-logo-oat.png" width="323" height="205" />
    </svg>
  );
}

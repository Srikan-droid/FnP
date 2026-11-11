/**
 * "Read more" under a question cut off with "…", and "Read less" once it is shown in full. Shown
 * only while there is more to read (or the text is open).
 */
export default function ReadMore({
  clipped,
  full,
  onToggle,
  className = "",
}: {
  clipped: boolean;
  full: boolean;
  onToggle: () => void;
  className?: string;
}) {
  if (!clipped && !full) return null;
  return (
    <button type="button" className={`link-button read-more ${className}`.trim()} aria-expanded={full} onClick={onToggle}>
      {full ? "Read less" : "Read more"}
    </button>
  );
}

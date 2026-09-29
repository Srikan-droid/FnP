import { BAND_ZONES } from "../domain/bands";
import type { Band } from "../domain/types";

const TONE: Record<Band, string> = {
  Low: "good",
  Moderate: "warning",
  Elevated: "serious",
  High: "critical",
};

/**
 * A linear read of the same number the gauge shows, divided into the four bands the scoring
 * model defines. The track runs green through amber and orange to red in the direction of
 * increasing risk, with the colour stops sitting on the band boundaries, so the colour under
 * the marker is the colour of the band the score actually falls in.
 */
export default function RiskMeter({ score, band }: { score: number; band: Band }) {
  const position = Math.max(0, Math.min(100, score));

  return (
    <div className="riskmeter">
      <div className="riskmeter-head">
        <span className="riskmeter-title">Risk meter</span>
        <span className="riskmeter-reading">
          {score.toFixed(1)} · {band}
        </span>
      </div>

      <div
        className="riskmeter-track"
        role="img"
        aria-label={`Risk score ${score.toFixed(1)} of 100, in the ${band} band`}
      >
        {/* Boundaries at 10, 25 and 45 — the thresholds from the scoring model. */}
        {BAND_ZONES.slice(1).map((zone) => (
          <span key={zone.band} className="riskmeter-tick" style={{ left: `${zone.from}%` }} />
        ))}
        {/* Inset by half the thumb so it stays inside the track at 0 and at 100. */}
        <span
          className="riskmeter-marker"
          style={{ left: `calc(7px + (100% - 14px) * ${position / 100})` }}
        >
          <span className="riskmeter-thumb" />
        </span>
      </div>

      <ul className="riskmeter-legend">
        {BAND_ZONES.map((zone) => (
          <li
            key={zone.band}
            className={`riskmeter-band${zone.band === band ? " is-current" : ""}`}
          >
            <span className={`riskmeter-swatch tone-${TONE[zone.band]}`} />
            {zone.band}
            <span className="riskmeter-range">
              {zone.from}–{zone.to}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

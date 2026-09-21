import type { Band } from "../domain/types";

const SIZE = 168;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function ScoreGauge({ score, band }: { score: number; band: Band }) {
  const fraction = Math.max(0, Math.min(1, score / 100));

  return (
    <div
      className={`gauge band-${band.toLowerCase()}`}
      role="img"
      aria-label={`Risk score ${score.toFixed(1)} of 100 — ${band} band`}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--meter-track)"
            strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--meter)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
            className="gauge-fill"
          />
        </g>
      </svg>
      <div className="gauge-center">
        <span className="gauge-label">Risk score</span>
        <span className="gauge-value">{score.toFixed(1)}</span>
        <span className="gauge-scale">of 100</span>
      </div>
    </div>
  );
}

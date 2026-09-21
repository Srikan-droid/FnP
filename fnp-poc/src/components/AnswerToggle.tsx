import type { Answer } from "../domain/types";

const OPTIONS: Answer[] = ["Yes", "No", "N/A"];

export default function AnswerToggle({
  value,
  onChange,
  labelledBy,
}: {
  value: Answer;
  onChange: (answer: Answer) => void;
  labelledBy: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-labelledby={labelledBy}>
      {OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className={`segment${value === option ? " is-selected" : ""}${
            option === "N/A" ? " segment-na" : ""
          }`}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

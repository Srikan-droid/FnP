import type { Answer } from "../domain/types";

export default function AnswerToggle({
  value,
  options,
  onChange,
  labelledBy,
}: {
  value: Answer;
  options: Answer[];
  onChange: (answer: Answer) => void;
  labelledBy: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((option) => (
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

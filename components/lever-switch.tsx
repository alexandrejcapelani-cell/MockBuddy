"use client";

/**
 * A recessed slot with a gold knob that slides between positions, like a fruit machine's
 * selector. Underneath it is a real radio group, so it works with the keyboard (arrow keys
 * move between positions) and screen readers; the knob is decoration.
 */
export function LeverSwitch<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  note,
}: {
  legend: string;
  name: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  note: string;
}) {
  const position = Math.max(0, options.findIndex((option) => option.value === value));
  const share = `calc((100% - 0.5rem) / ${options.length})`;
  return (
    <fieldset className="space-y-3">
      <legend className="font-display text-xl font-semibold text-cream">{legend}</legend>
      <div
        className="relative grid max-w-md rounded-full bg-felt-deep p-1 shadow-[inset_0_2px_6px_rgb(0_0_0/0.6)]"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 left-1 rounded-full bg-gradient-to-b from-gold-bright to-gold shadow-[inset_0_1px_0_rgb(255_255_255/0.6)] transition-transform duration-200"
          style={{ width: share, transform: `translateX(${position * 100}%)` }}
        />
        {options.map((option) => (
          <label key={option.value} className="relative z-10 min-w-0 cursor-pointer text-center">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span className="block rounded-full px-1 py-2 text-xs font-bold tracking-[0.1em] text-cream uppercase peer-checked:text-felt-deep peer-focus-visible:outline-3 peer-focus-visible:outline-gold-bright sm:text-sm sm:tracking-[0.18em]">
              {option.label}
            </span>
          </label>
        ))}
      </div>
      <p className="max-w-md text-sm text-dim">{note}</p>
    </fieldset>
  );
}

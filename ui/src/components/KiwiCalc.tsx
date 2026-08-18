import { useMemo, useState } from "react";
import { evaluateCalc, parseCalcBlock, type CalcDoc } from "@kw/lib/calcBlock";

function assumptionSlider(name: string, value: number, onChange: (n: number) => void) {
  if (!Number.isFinite(value) || value === 0) return null;
  const abs = Math.abs(value);
  const min = abs > 1 ? abs / 100 : abs / 10;
  const max = abs * 100;
  const useLog = abs >= 10;
  const toSlider = (n: number) => (useLog ? Math.log10(Math.max(n, min)) : n);
  const fromSlider = (n: number) => (useLog ? 10 ** n : n);
  return (
    <input
      type="range"
      aria-label={`Adjust ${name}`}
      min={toSlider(min)}
      max={toSlider(max)}
      step={useLog ? 0.01 : Math.max(abs / 100, 0.01)}
      value={toSlider(value)}
      onChange={(e) => onChange(fromSlider(Number(e.target.value)))}
    />
  );
}

export function KiwiCalc({ source }: { source: string }) {
  const parsed = useMemo<{ doc: CalcDoc | null; error: string | null }>(() => {
    try {
      return { doc: parseCalcBlock(source), error: null };
    } catch (err) {
      return { doc: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [source]);

  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [interactive, setInteractive] = useState(false);

  const result = useMemo(() => {
    if (!parsed.doc) return null;
    return evaluateCalc(parsed.doc, overrides);
  }, [parsed.doc, overrides]);

  if (parsed.error || !result) {
    return (
      <div className="kiwi-calc kiwi-calc-error rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        Calc error: {parsed.error}
      </div>
    );
  }

  return (
    <div className="kiwi-calc">
      <div className="kiwi-calc-toolbar">
        <span className="kiwi-calc-label">Assumptions</span>
        <button
          type="button"
          className={interactive ? "is-on" : ""}
          onClick={() => {
            setInteractive((v) => !v);
            if (interactive) setOverrides({});
          }}
        >
          {interactive ? "Reset sliders" : "Tune"}
        </button>
      </div>
      <table>
        <tbody>
          {result.rows.map((row) => (
            <tr key={`${row.kind}-${row.name}`} className={`kiwi-calc-${row.kind}${row.error ? " is-error" : ""}`}>
              <th scope="row">
                <code>{row.name}</code>
              </th>
              <td className="kiwi-calc-raw">
                {row.kind === "assumption" && interactive ? (
                  <div className="kiwi-calc-slider">
                    {assumptionSlider(row.name, row.value, (n) => {
                      setOverrides((prev) => ({ ...prev, [row.name]: n }));
                    })}
                    <code>{row.raw}</code>
                  </div>
                ) : (
                  <code>{row.raw}</code>
                )}
              </td>
              <td className="kiwi-calc-value">{row.error ? row.error : row.formatted}</td>
              <td className="kiwi-calc-comment">{row.comment ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

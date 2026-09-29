import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useLocalState } from "@kw/widgets/useLocalState";
import {
  gradeQuiz,
  quizSpecFromAttr,
  shuffleWithSeed,
  type QuizKind,
  type QuizSpec,
} from "@kw/lib/quizBlock";

type Attempt = { correct: boolean; attempts: number; lastAt: string };
type QuizStore = Record<string, Attempt>;

type Registry = {
  pagePath: string;
  summary: { correct: number; total: number };
  saved: (id: string) => Attempt | undefined;
  record: (id: string, correct: boolean) => void;
  report: (id: string, correct: boolean | null | undefined) => void;
};

const QuizContext = React.createContext<Registry | null>(null);

const KIND_NOTE: Partial<Record<QuizKind, string>> = {
  multi: "Select all that apply",
  order: "Put these in order",
  match: "Match each one",
};

function attemptKey(pagePath: string, id: string): string {
  return `${pagePath || "page"}#${id}`;
}

export function KiwiQuizProvider({ pagePath, children }: { pagePath: string; children: React.ReactNode }) {
  const local = useLocalState<QuizStore>("quiz");
  const storeRef = useRef<QuizStore>({});
  const [store, setStore] = useState<QuizStore>({});
  const [status, setStatus] = useState<Record<string, boolean | null>>({});

  useEffect(() => {
    if (!local.data) return;
    const merged = { ...local.data, ...storeRef.current };
    const dirty = JSON.stringify(merged) !== JSON.stringify(local.data);
    storeRef.current = merged;
    setStore(merged);
    if (dirty) void local.save(merged);
  }, [local.data, local.save]);

  const record = useCallback((id: string, correct: boolean) => {
    const key = attemptKey(pagePath, id);
    const prev = storeRef.current[key];
    const next: QuizStore = {
      ...storeRef.current,
      [key]: {
        correct,
        attempts: (prev?.attempts ?? 0) + 1,
        lastAt: new Date().toISOString(),
      },
    };
    storeRef.current = next;
    setStore(next);
    void local.save(next);
  }, [local.save, pagePath]);

  const report = useCallback((id: string, correct: boolean | null | undefined) => {
    setStatus((prev) => {
      if (correct === undefined) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      if (prev[id] === correct) return prev;
      return { ...prev, [id]: correct };
    });
  }, []);

  const summary = useMemo(() => {
    const values = Object.values(status);
    return { total: values.length, correct: values.filter((value) => value === true).length };
  }, [status]);

  const saved = useCallback((id: string) => store[attemptKey(pagePath, id)], [pagePath, store]);

  const value = useMemo<Registry>(() => ({
    pagePath,
    summary,
    saved,
    record,
    report,
  }), [pagePath, summary, saved, record, report]);

  return <QuizContext.Provider value={value}>{children}</QuizContext.Provider>;
}

export function useQuizSummary(): { correct: number; total: number } | null {
  return useContext(QuizContext)?.summary ?? null;
}

export function KiwiQuizScore() {
  const summary = useQuizSummary();
  if (!summary || summary.total === 0) return null;
  return (
    <div className="kiwi-quiz-score" aria-live="polite">
      {summary.correct} / {summary.total}
    </div>
  );
}

function QuizInline({ children }: { children?: React.ReactNode }) {
  return <span>{children}</span>;
}

const inlineMarkdown = { p: QuizInline };

function Inline({ text }: { text: string }) {
  if (!/[*_`[\]]/.test(text)) return <span>{text}</span>;
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={inlineMarkdown}>
      {text}
    </ReactMarkdown>
  );
}

function Block({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="kiwi-quiz-explain">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

export function KiwiQuiz({ specAttr }: { specAttr: string }) {
  const spec = useMemo(() => quizSpecFromAttr(specAttr), [specAttr]);
  if (!spec) return null;
  if (spec.error) {
    return <div className="kiwi-quiz kiwi-quiz-error" role="alert">{spec.error}</div>;
  }
  if (spec.kind === "short") return <ShortAnswer spec={spec} />;
  return <QuizCard spec={spec} />;
}

function ShortAnswer({ spec }: { spec: QuizSpec }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="kiwi-quiz" role="group" aria-label={spec.prompt} data-quiz-id={spec.id} data-quiz-kind="short">
      <div className="kiwi-quiz-prompt"><Inline text={spec.prompt} /></div>
      <button
        type="button"
        className={open ? "kiwi-quiz-reveal is-open" : "kiwi-quiz-reveal"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>Show answers</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div className="kiwi-quiz-reveal-body">
          {spec.accept[0] ? <div className="kiwi-quiz-answer"><Inline text={spec.accept[0]} /></div> : null}
          <Block text={spec.explanation} />
        </div>
      ) : null}
    </div>
  );
}

function QuizCard({ spec }: { spec: QuizSpec }) {
  const ctx = useContext(QuizContext);
  const seed = useState(() => (Math.floor(Math.random() * 0x7fffffff) || 1))[0];
  const shuffle = spec.kind === "order" || spec.kind === "match" || spec.shuffle;
  const optionOrder = useMemo(
    () => (shuffle ? shuffleWithSeed(spec.options.map((o) => o.id), seed) : spec.options.map((o) => o.id)),
    [shuffle, seed, spec.options],
  );
  const itemOrder = useMemo(
    () => shuffleWithSeed(spec.items.map((item) => item.id), seed + 1),
    [seed, spec.items],
  );
  const pairOrder = useMemo(
    () => (shuffle ? shuffleWithSeed(spec.pairs.map((pair) => pair.id), seed + 2) : spec.pairs.map((pair) => pair.id)),
    [shuffle, seed, spec.pairs],
  );
  const rightChoices = useMemo(
    () => shuffleWithSeed(spec.pairs.map((pair) => pair.right), seed + 3),
    [seed, spec.pairs],
  );

  const saved = ctx?.saved(spec.id);
  const [phase, setPhase] = useState<"open" | "done">(saved?.correct ? "done" : "open");
  const [picked, setPicked] = useState<string[]>(() => (
    saved?.correct ? spec.options.filter((o) => o.correct).map((o) => o.id) : []
  ));
  const [order, setOrder] = useState<string[]>(() => (
    saved?.correct ? spec.items.map((item) => item.id) : itemOrder
  ));
  const [pairs, setPairs] = useState<Record<string, string>>(() => (
    saved?.correct ? Object.fromEntries(spec.pairs.map((pair) => [pair.id, pair.right])) : {}
  ));
  const revealed = phase === "done";
  const correct = revealed && gradeQuiz(spec, { picked, order, pairs, text: "" });
  const hydrated = useRef(phase === "done");
  const reportRef = useRef(ctx?.report);
  reportRef.current = ctx?.report;

  useLayoutEffect(() => {
    reportRef.current?.(spec.id, revealed ? correct : null);
  }, [spec.id, revealed, correct]);

  useLayoutEffect(() => {
    const id = spec.id;
    return () => reportRef.current?.(id, undefined);
  }, [spec.id]);

  useEffect(() => {
    if (hydrated.current || !saved?.correct) return;
    hydrated.current = true;
    setPhase("done");
    setPicked(spec.options.filter((o) => o.correct).map((o) => o.id));
    setOrder(spec.items.map((item) => item.id));
    setPairs(Object.fromEntries(spec.pairs.map((pair) => [pair.id, pair.right])));
  }, [saved?.correct, spec]);

  function response() {
    return { picked, order, pairs, text: "" };
  }

  function canCheck(): boolean {
    if (spec.kind === "order") return order.length > 1;
    if (spec.kind === "match") return spec.pairs.every((pair) => pairs[pair.id]);
    return picked.length > 0;
  }

  function check() {
    if (!canCheck()) return;
    const ok = gradeQuiz(spec, response());
    setPhase("done");
    ctx?.record(spec.id, ok);
    ctx?.report(spec.id, ok);
  }

  function retry() {
    hydrated.current = true;
    setPhase("open");
    setPicked([]);
    setOrder(itemOrder);
    setPairs({});
    ctx?.report(spec.id, null);
  }

  function toggleOption(id: string) {
    if (revealed) return;
    if (spec.kind === "multi") {
      setPicked((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
      return;
    }
    setPicked([id]);
  }

  function moveItem(index: number, dir: -1 | 1) {
    if (revealed) return;
    const next = index + dir;
    if (next < 0 || next >= order.length) return;
    setOrder((prev) => {
      const copy = prev.slice();
      const [item] = copy.splice(index, 1);
      copy.splice(next, 0, item);
      return copy;
    });
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const tag = (event.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      if (event.key === "Enter" && phase === "open") {
        event.preventDefault();
        check();
      }
    }
  }

  const note = KIND_NOTE[spec.kind];

  return (
    <div
      className="kiwi-quiz"
      role="group"
      aria-label={spec.prompt}
      data-quiz-id={spec.id}
      data-quiz-kind={spec.kind}
      data-quiz-state={revealed ? (correct ? "correct" : "wrong") : "open"}
      onKeyDown={onKeyDown}
    >
      <div className="kiwi-quiz-prompt"><Inline text={spec.prompt} /></div>
      {note ? <p className="kiwi-quiz-note">{note}</p> : null}
      {spec.kind === "order" ? (
        <OrderList spec={spec} order={order} revealed={revealed} correct={correct} onMove={moveItem} />
      ) : spec.kind === "match" ? (
        <MatchList spec={spec} pairOrder={pairOrder} rights={rightChoices} pairs={pairs} revealed={revealed} onChange={(id, right) => setPairs((prev) => {
          const next = { ...prev, [id]: right };
          if (right) {
            for (const key of Object.keys(next)) {
              if (key !== id && next[key] === right) delete next[key];
            }
          }
          return next;
        })} />
      ) : (
        <ChoiceList spec={spec} optionOrder={optionOrder} picked={picked} revealed={revealed} onToggle={toggleOption} />
      )}
      {revealed ? (
        <div className={`kiwi-quiz-after${correct ? " is-correct" : ""}`} role="status">
          <p className="kiwi-quiz-result">{correct ? "Correct" : "Not quite"}</p>
          <Block text={spec.explanation} />
          <div className="kiwi-quiz-actions">
            <button type="button" className="kiwi-quiz-again" onClick={retry}>Try again</button>
          </div>
        </div>
      ) : (
        <div className="kiwi-quiz-actions">
          <button type="button" className="kiwi-quiz-submit" disabled={!canCheck()} onClick={check}>Submit</button>
        </div>
      )}
    </div>
  );
}

function ChoiceList({
  spec,
  optionOrder,
  picked,
  revealed,
  onToggle,
}: {
  spec: QuizSpec;
  optionOrder: string[];
  picked: string[];
  revealed: boolean;
  onToggle: (id: string) => void;
}) {
  const multi = spec.kind === "multi";
  return (
    <div className="kiwi-quiz-options" role={multi ? "group" : "radiogroup"}>
      {optionOrder.map((id) => {
        const option = spec.options.find((item) => item.id === id);
        if (!option) return null;
        const on = picked.includes(option.id);
        const showNote = revealed && !!option.feedback && (option.correct || on);
        const cls = [
          "kiwi-quiz-option",
          multi ? "is-multi" : "",
          on && !revealed ? "is-picked" : "",
          revealed && option.correct ? "is-correct" : "",
          revealed && on && !option.correct ? "is-wrong" : "",
          revealed && !option.correct && !on ? "is-quiet" : "",
        ].filter(Boolean).join(" ");
        return (
          <div key={option.id} className="kiwi-quiz-choice">
            <button
              type="button"
              className={cls}
              role={multi ? "checkbox" : "radio"}
              aria-checked={on}
              disabled={revealed}
              onClick={() => onToggle(option.id)}
            >
              <span className="kiwi-quiz-mark" aria-hidden="true" />
              <span className="kiwi-quiz-option-body">
                <span className="kiwi-quiz-option-text"><Inline text={option.text} /></span>
                {showNote ? <span className="kiwi-quiz-feedback"><Inline text={option.feedback!} /></span> : null}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function OrderList({
  spec,
  order,
  revealed,
  correct,
  onMove,
}: {
  spec: QuizSpec;
  order: string[];
  revealed: boolean;
  correct: boolean;
  onMove: (index: number, dir: -1 | 1) => void;
}) {
  return (
    <ol className="kiwi-quiz-order">
      {order.map((id, index) => {
        const item = spec.items.find((row) => row.id === id);
        if (!item) return null;
        const place = spec.items.findIndex((row) => row.id === id);
        const cls = [
          "kiwi-quiz-order-row",
          revealed && !correct && place !== index ? "is-wrong" : "",
        ].filter(Boolean).join(" ");
        return (
          <li key={id} className={cls}>
            <span className="kiwi-quiz-option-text"><Inline text={item.text} /></span>
            {revealed ? null : (
              <span className="kiwi-quiz-moves">
                <button type="button" className="kiwi-quiz-icon" aria-label={`Move ${item.text} up`} disabled={index === 0} onClick={() => onMove(index, -1)}>
                  <ChevronUp aria-hidden="true" />
                </button>
                <button type="button" className="kiwi-quiz-icon" aria-label={`Move ${item.text} down`} disabled={index === order.length - 1} onClick={() => onMove(index, 1)}>
                  <ChevronDown aria-hidden="true" />
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function MatchList({
  spec,
  pairOrder,
  rights,
  pairs,
  revealed,
  onChange,
}: {
  spec: QuizSpec;
  pairOrder: string[];
  rights: string[];
  pairs: Record<string, string>;
  revealed: boolean;
  onChange: (id: string, right: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  function pick(id: string, right: string) {
    onChange(id, right);
    setOpenId(null);
  }

  return (
    <div className="kiwi-quiz-match">
      {pairOrder.map((id) => {
        const pair = spec.pairs.find((row) => row.id === id);
        if (!pair) return null;
        const chosen = pairs[pair.id] ?? "";
        const matched = chosen === pair.right;
        const open = openId === pair.id;
        if (revealed) {
          return (
            <div key={pair.id} className={matched ? "kiwi-quiz-match-settled" : "kiwi-quiz-match-settled is-wrong"}>
              <div className="kiwi-quiz-option-text"><Inline text={pair.left} /></div>
              {matched ? null : <div className="kiwi-quiz-match-yours">{chosen}</div>}
              <div className="kiwi-quiz-match-right"><Inline text={pair.right} /></div>
              {pair.feedback ? <div className="kiwi-quiz-feedback"><Inline text={pair.feedback} /></div> : null}
            </div>
          );
        }
        return (
          <div key={pair.id} className="kiwi-quiz-match-item">
            <button
              type="button"
              className={open ? "kiwi-quiz-match-pick is-open" : "kiwi-quiz-match-pick"}
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : pair.id)}
            >
              <span className="kiwi-quiz-match-copy">
                <span className="kiwi-quiz-option-text"><Inline text={pair.left} /></span>
                <span className={chosen ? "kiwi-quiz-match-value is-set" : "kiwi-quiz-match-value"}>{chosen || "Select"}</span>
              </span>
              <ChevronDown aria-hidden="true" />
            </button>
            {open ? (
              <div className="kiwi-quiz-options kiwi-quiz-match-choices" role="listbox" aria-label={`Choices for ${pair.left}`}>
                {rights.map((value) => {
                  const taken = Object.entries(pairs).some(([key, picked]) => key !== pair.id && picked === value);
                  const on = chosen === value;
                  const cls = ["kiwi-quiz-option", on ? "is-picked" : "", !on && taken ? "is-quiet" : ""].filter(Boolean).join(" ");
                  return (
                    <button key={value} type="button" className={cls} role="option" aria-selected={on} onClick={() => pick(pair.id, value)}>
                      <span className="kiwi-quiz-mark" aria-hidden="true" />
                      <span className="kiwi-quiz-option-body">
                        <span className="kiwi-quiz-option-text"><Inline text={value} /></span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}


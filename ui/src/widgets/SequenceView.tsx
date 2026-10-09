import { useId } from "react";

import { alpha } from "./colors";
import { pointAlong, textWidth, wrapText, type NodeShape } from "./graphGeometry";
import { ShapeOutline } from "./ShapeOutline";
import { arrivalOpacity, useFlowProgress } from "./useFlowProgress";
import { SvgLabel } from "./WidgetText";
import { ZoomPanel } from "./ZoomPanel";

export interface SequenceParticipant {
  id: string;
  label?: string;
  shape?: Extract<NodeShape, "box" | "person" | "cylinder" | "queue" | "pill" | "cloud">;
  color?: string;
}

export interface SequenceMessage {
  from: string;
  to: string;
  label?: string;
  /** `"sync"` (default) solid + filled head, `"async"` open head, `"reply"` dashed. */
  kind?: "sync" | "async" | "reply";
}

export interface SequenceNote {
  note: string;
  /** One participant, or two to span between them. */
  over: string | string[];
}

export interface SequenceDivider {
  divider: string;
}

export type SequenceItem = SequenceMessage | SequenceNote | SequenceDivider;

export interface SequenceFrame {
  /** Tab text, e.g. "alt", "loop", "opt", "par". Default "alt". */
  kind?: string;
  /** Condition shown next to the tab, e.g. "[cache miss]". */
  label?: string;
  /** First and last item index covered (inclusive). */
  from: number;
  to: number;
  color?: string;
}

export interface SequenceViewProps {
  participants: SequenceParticipant[];
  items: SequenceItem[];
  /**
   * Items revealed so far. Item `step - 1` is the active one; later items are
   * ghosted (or hidden, see `future`). Omit to show every item, none active.
   */
  step?: number;
  /** How to draw items after the active one. Default "ghost". */
  future?: "ghost" | "hide";
  frames?: SequenceFrame[];
  /** Prefix each message with its number. */
  numbered?: boolean;
  /** Move a dot along the active message. Default true. */
  packet?: boolean;
  zoomable?: boolean;
  activeColor?: string;
  /** Maximum display width; the diagram scales down to fit. */
  width?: number;
}

const C = {
  active: "var(--kw-widget-active, #a78bfa)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  dim: "var(--kw-widget-dim, #64748b)",
  surface: "var(--kw-widget-surface, #18181b)",
  raised: "var(--kw-widget-surface-raised, #27272a)",
};
const SANS = "ui-sans-serif, system-ui, sans-serif";

const isMessage = (it: SequenceItem): it is SequenceMessage => "from" in it && "to" in it;
const isNote = (it: SequenceItem): it is SequenceNote => "note" in it;

export function SequenceView({
  participants,
  items,
  step,
  future = "ghost",
  frames = [],
  numbered = false,
  packet = true,
  zoomable = false,
  activeColor = C.active,
  width,
}: SequenceViewProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const active = step === undefined ? -1 : step - 1;
  const progress = useFlowProgress(step === undefined ? "" : `${active}`, { enabled: packet, rest: 0.5 });

  const lane = new Map(participants.map((p, i) => [p.id, i]));
  const head = participants.map((p) => {
    const label = p.label ?? p.id;
    const shape = p.shape ?? "box";
    const w = Math.max(88, textWidth(label, 13) + 26);
    const h = shape === "person" ? 50 : shape === "cylinder" ? 46 : 36;
    return { ...p, label, shape, w, h };
  });
  const headH = Math.max(36, ...head.map((p) => p.h));

  const msgLabel = (m: SequenceMessage, n: number) =>
    numbered ? `${n}. ${m.label ?? ""}`.trim() : m.label ?? "";

  // Space between adjacent lanes: fit both heads and every message label
  // spread over the lanes it spans.
  const gaps = participants.slice(1).map((_, i) => (head[i]!.w + head[i + 1]!.w) / 2 + 28);
  let selfRight = 0;
  let messageNo = 0;
  items.forEach((it) => {
    if (!isMessage(it)) return;
    messageNo++;
    const a = lane.get(it.from);
    const b = lane.get(it.to);
    if (a === undefined || b === undefined) return;
    const lw = textWidth(msgLabel(it, messageNo), 12) + 24;
    if (a === b) {
      const need = lw + 34;
      if (a < gaps.length) gaps[a] = Math.max(gaps[a]!, need);
      else selfRight = Math.max(selfRight, need);
      return;
    }
    const lo = Math.min(a, b);
    const span = Math.abs(a - b);
    for (let k = lo; k < lo + span; k++) gaps[k] = Math.max(gaps[k]!, lw / span);
  });

  const marginX = 12;
  const xs: number[] = [];
  let x = marginX + (head[0]?.w ?? 88) / 2;
  participants.forEach((_, i) => {
    xs.push(x);
    x += gaps[i] ?? 0;
  });
  const lastX = xs[xs.length - 1] ?? x;
  const totalW = Math.max(
    lastX + (head[head.length - 1]?.w ?? 88) / 2 + marginX,
    lastX + selfRight + marginX,
  );

  // Vertical rhythm, with room for frame tabs above the items they open.
  const tabAbove = items.map((_, i) => frames.filter((f) => f.from === i).length * 22);
  const padBelow = items.map((_, i) => frames.filter((f) => f.to === i).length * 8);
  const rowTop: number[] = [];
  const rowH: number[] = [];
  let y = 8 + headH + 18;
  messageNo = 0;
  const noteLines = new Map<number, string[]>();
  items.forEach((it, i) => {
    y += tabAbove[i]!;
    rowTop.push(y);
    let h: number;
    if (isMessage(it)) h = it.from === it.to ? 52 : 38;
    else if (isNote(it)) {
      const lines = wrapText(it.note, 12, 220);
      noteLines.set(i, lines);
      h = lines.length * 15 + 22;
    } else h = 32;
    rowH.push(h);
    y += h + padBelow[i]!;
  });
  const bottom = y + 8;
  const totalH = bottom + 6;

  const stateOf = (i: number): "past" | "active" | "future" =>
    active < 0 ? "past" : i < active ? "past" : i === active ? "active" : "future";
  const visible = (i: number) => !(future === "hide" && stateOf(i) === "future");
  const opacityOf = (i: number) => (stateOf(i) === "future" ? 0.16 : 1);

  const activeItem = active >= 0 ? items[active] : undefined;
  const busy = new Set<string>();
  if (activeItem && isMessage(activeItem)) {
    busy.add(activeItem.from);
    busy.add(activeItem.to);
  } else if (activeItem && isNote(activeItem)) {
    for (const id of [activeItem.over].flat()) busy.add(id);
  }

  const filled = `kw-seq-${uid}-filled`;
  const open = `kw-seq-${uid}-open`;
  const filledActive = `${filled}-a`;
  const openActive = `${open}-a`;
  const displayW = width !== undefined ? Math.min(width, totalW) : totalW;

  let n = 0;
  const svg = (
    <svg
      width={Math.round(displayW)}
      height={Math.round((displayW * totalH) / totalW)}
      viewBox={`0 0 ${totalW} ${totalH}`}
      style={{ display: "block", maxWidth: "100%", height: "auto" }}
      role="img"
    >
      <defs>
        {[
          [filled, C.dim, true],
          [filledActive, activeColor, true],
          [open, C.dim, false],
          [openActive, activeColor, false],
        ].map(([id, color, solid]) => (
          <marker key={id as string} id={id as string} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
            {solid ? (
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color as string} />
            ) : (
              <path d="M 1 1 L 10 5 L 1 9" fill="none" stroke={color as string} strokeWidth={1.6} />
            )}
          </marker>
        ))}
      </defs>

      {frames.map((f, k) => {
        const covered = items.slice(f.from, f.to + 1);
        const ids = covered.flatMap((it) => (isMessage(it) ? [it.from, it.to] : isNote(it) ? [it.over].flat() : []));
        const lanesUsed = ids.map((id) => lane.get(id)).filter((v): v is number => v !== undefined);
        const lo = lanesUsed.length ? Math.min(...lanesUsed) : 0;
        const hi = lanesUsed.length ? Math.max(...lanesUsed) : participants.length - 1;
        const nest = frames.filter((o, j) => j < k && o.from <= f.from && o.to >= f.to).length;
        const pad = 26 - nest * 6;
        const hasSelf = covered.some((it) => isMessage(it) && it.from === it.to && lane.get(it.from) === hi);
        const x0 = xs[lo]! - pad - (lo === hi ? 40 : 0);
        const x1 = xs[hi]! + pad + (hasSelf ? 60 : lo === hi ? 40 : 0);
        const y0 = rowTop[f.from]! - 20;
        const y1 = rowTop[f.to]! + rowH[f.to]! - 2;
        const color = f.color ?? C.dim;
        const tab = f.kind ?? "alt";
        const tabW = textWidth(tab, 10) + 14;
        const allFuture = stateOf(f.from) === "future";
        if (future === "hide" && allFuture) return null;
        return (
          <g key={`frame-${k}`} opacity={allFuture ? 0.25 : 1}>
            <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx={4} fill={alpha(color, 5)} stroke={alpha(color, 70)} strokeWidth={1} />
            <path d={`M ${x0} ${y0 + 16} L ${x0 + tabW} ${y0 + 16} L ${x0 + tabW + 6} ${y0 + 10} L ${x0 + tabW + 6} ${y0}`} fill="none" stroke={alpha(color, 70)} />
            <SvgLabel plain x={x0 + 6} y={y0 + 12} text={tab} fill={C.text} fontSize={10} fontWeight={700} fontFamily={SANS} />
            {f.label && <SvgLabel plain x={x0 + tabW + 12} y={y0 + 12} text={f.label} fill={C.text} fontSize={11} fontWeight={500} fontFamily={SANS} style={{ opacity: 0.8 }} />}
          </g>
        );
      })}

      {head.map((p, i) => (
        <line key={`life-${p.id}`} x1={xs[i]} y1={8 + headH} x2={xs[i]} y2={bottom} stroke={busy.has(p.id) ? activeColor : C.border} strokeWidth={busy.has(p.id) ? 1.5 : 1} strokeDasharray="4 4" />
      ))}

      {head.map((p, i) => {
        const isBusy = busy.has(p.id);
        const cy = 8 + headH - p.h / 2;
        const stroke = isBusy ? activeColor : p.color ?? C.border;
        const fill = isBusy ? alpha(activeColor, 18) : p.color ? alpha(p.color, 14) : C.raised;
        const labelY = p.shape === "person" ? cy + 15 : p.shape === "cylinder" ? cy + 4 : cy;
        return (
          <g key={`head-${p.id}`}>
            <ShapeOutline shape={p.shape} x={xs[i]!} y={cy} w={p.shape === "person" ? Math.max(40, p.w * 0.5) : p.w} h={p.h} fill={fill} stroke={stroke} strokeWidth={isBusy ? 2 : 1.5} />
            <SvgLabel plain x={xs[i]!} y={labelY} text={p.label} anchor="middle" dominantBaseline="central" fill={C.text} fontSize={13} fontWeight={600} fontFamily={SANS} />
          </g>
        );
      })}

      {items.map((it, i) => {
        if (isMessage(it)) n++;
        if (!visible(i)) return null;
        const state = stateOf(i);
        const isActive = state === "active";
        const top = rowTop[i]!;
        const h = rowH[i]!;

        if (isMessage(it)) {
          const a = lane.get(it.from);
          const b = lane.get(it.to);
          if (a === undefined || b === undefined) return null;
          const kind = it.kind ?? "sync";
          const color = isActive ? activeColor : C.dim;
          const marker = `url(#${kind === "sync" ? (isActive ? filledActive : filled) : isActive ? openActive : open})`;
          const label = msgLabel(it, n);
          const lineY = top + h - 10;
          if (a === b) {
            const x0 = xs[a]!;
            const y0 = top + 12;
            const d = `M ${x0} ${y0} H ${x0 + 30} V ${lineY} H ${x0 + 1}`;
            const at = isActive && packet ? pointAlong([{ x: x0, y: y0 }, { x: x0 + 30, y: y0 }, { x: x0 + 30, y: lineY }, { x: x0, y: lineY }], progress) : null;
            return (
              <g key={`item-${i}`} opacity={opacityOf(i)}>
                <path d={d} fill="none" stroke={color} strokeWidth={isActive ? 2.2 : 1.5} strokeDasharray={kind === "reply" ? "5 4" : undefined} markerEnd={marker} />
                <SvgLabel plain x={x0 + 38} y={(y0 + lineY) / 2} text={label} dominantBaseline="central" fill={isActive ? activeColor : C.text} fontSize={12} fontWeight={isActive ? 700 : 500} fontFamily={SANS} />
                {at && <circle cx={at.x} cy={at.y} r={5} fill={activeColor} stroke={C.surface} strokeWidth={2} opacity={arrivalOpacity(progress)} />}
              </g>
            );
          }
          const xa = xs[a]!;
          const xb = xs[b]!;
          const dir = Math.sign(xb - xa);
          const x1 = xa + dir * 2;
          const x2 = xb - dir * 2;
          const at = isActive && packet ? { x: x1 + (x2 - x1) * progress, y: lineY } : null;
          return (
            <g key={`item-${i}`} opacity={opacityOf(i)}>
              <line x1={x1} y1={lineY} x2={x2} y2={lineY} stroke={color} strokeWidth={isActive ? 2.2 : 1.5} strokeDasharray={kind === "reply" ? "5 4" : undefined} markerEnd={marker} />
              <SvgLabel plain x={(xa + xb) / 2} y={lineY - 9} text={label} anchor="middle" fill={isActive ? activeColor : C.text} fontSize={12} fontWeight={isActive ? 700 : 500} fontFamily={SANS} halo={C.surface} />
              {at && <circle cx={at.x} cy={at.y} r={5} fill={activeColor} stroke={C.surface} strokeWidth={2} opacity={arrivalOpacity(progress)} />}
            </g>
          );
        }

        if (isNote(it)) {
          const over = [it.over].flat().map((id) => lane.get(id)).filter((v): v is number => v !== undefined);
          const lines = noteLines.get(i) ?? [it.note];
          const tw = Math.max(...lines.map((l) => textWidth(l, 12))) + 20;
          const lo = over.length ? xs[Math.min(...over)]! : xs[0]!;
          const hi = over.length ? xs[Math.max(...over)]! : xs[0]!;
          const w = Math.max(tw, hi - lo + 40);
          const cx = (lo + hi) / 2;
          return (
            <g key={`item-${i}`} opacity={opacityOf(i)}>
              <rect x={cx - w / 2} y={top + 4} width={w} height={h - 8} rx={4} fill={isActive ? alpha(activeColor, 16) : C.raised} stroke={isActive ? activeColor : C.border} />
              {lines.map((line, j) => (
                <SvgLabel plain key={j} x={cx} y={top + 4 + 11 + j * 15 + 1} text={line} anchor="middle" dominantBaseline="central" fill={C.text} fontSize={12} fontWeight={isActive ? 600 : 400} fontFamily={SANS} />
              ))}
            </g>
          );
        }

        const label = (it as SequenceDivider).divider;
        const cy = top + h / 2;
        const lw = textWidth(label, 11) * 1.08 + 24;
        return (
          <g key={`item-${i}`} opacity={opacityOf(i)}>
            <line x1={8} y1={cy} x2={totalW - 8} y2={cy} stroke={C.border} strokeWidth={1} />
            <rect x={totalW / 2 - lw / 2} y={cy - 9} width={lw} height={18} rx={9} fill={C.raised} stroke={isActive ? activeColor : C.border} />
            <SvgLabel plain x={totalW / 2} y={cy} text={label} anchor="middle" dominantBaseline="central" fill={C.text} fontSize={11} fontWeight={700} fontFamily={SANS} />
          </g>
        );
      })}
    </svg>
  );

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0" }}>
      {zoomable ? <div style={{ width: "100%" }}><ZoomPanel>{svg}</ZoomPanel></div> : svg}
    </div>
  );
}

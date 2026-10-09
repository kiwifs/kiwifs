import type { NodeShape } from "./graphGeometry";

export interface ShapeOutlineProps {
  shape: NodeShape;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  strokeWidth?: number;
  strokeDasharray?: string;
}

/** Draw one node outline centred on (x, y) with outer size w × h. */
export function ShapeOutline({ shape, x, y, w, h, fill, stroke, strokeWidth = 2, strokeDasharray }: ShapeOutlineProps) {
  const hw = w / 2;
  const hh = h / 2;
  const common = { fill, stroke, strokeWidth, strokeDasharray, style: { transition: "fill 0.25s ease, stroke 0.25s ease" } };
  switch (shape) {
    case "circle":
      return <circle cx={x} cy={y} r={hw} {...common} />;
    case "pill":
      return <rect x={x - hw} y={y - hh} width={w} height={h} rx={hh} {...common} />;
    case "diamond":
      return <polygon points={`${x},${y - hh} ${x + hw},${y} ${x},${y + hh} ${x - hw},${y}`} {...common} />;
    case "hexagon": {
      const i = Math.min(hh * 0.6, hw * 0.3);
      return (
        <polygon
          points={`${x - hw + i},${y - hh} ${x + hw - i},${y - hh} ${x + hw},${y} ${x + hw - i},${y + hh} ${x - hw + i},${y + hh} ${x - hw},${y}`}
          {...common}
        />
      );
    }
    case "cylinder": {
      const ry = Math.min(9, h * 0.14);
      const top = y - hh + ry;
      const bottom = y + hh - ry;
      return (
        <g>
          <path
            d={`M ${x - hw} ${top} L ${x - hw} ${bottom} A ${hw} ${ry} 0 0 0 ${x + hw} ${bottom} L ${x + hw} ${top}`}
            {...common}
          />
          <ellipse cx={x} cy={top} rx={hw} ry={ry} {...common} />
        </g>
      );
    }
    case "queue": {
      const slots = [10, 17, 24].map((dx) => x + hw - dx);
      return (
        <g>
          <rect x={x - hw} y={y - hh} width={w} height={h} rx={4} {...common} />
          {slots.map((sx) => (
            <line key={sx} x1={sx} y1={y - hh + 5} x2={sx} y2={y + hh - 5} stroke={stroke} strokeWidth={1.25} opacity={0.7} />
          ))}
        </g>
      );
    }
    case "person": {
      const top = y - hh;
      return (
        <g>
          <circle cx={x} cy={top + 8} r={7} {...common} />
          <path
            d={`M ${x - 13} ${top + 30} Q ${x - 13} ${top + 17} ${x} ${top + 17} Q ${x + 13} ${top + 17} ${x + 13} ${top + 30} Z`}
            {...common}
          />
        </g>
      );
    }
    case "cloud":
      return (
        <path
          transform={`translate(${x - hw} ${y - hh}) scale(${w / 100} ${h / 60})`}
          d="M25,57 C9,57 2,45 9,36 C2,25 13,12 26,17 C30,4 51,0 59,13 C67,4 86,9 85,23 C98,26 99,46 86,51 C82,59 70,59 65,57 Z"
          vectorEffect="non-scaling-stroke"
          {...common}
        />
      );
    case "box":
    default:
      return <rect x={x - hw} y={y - hh} width={w} height={h} rx={6} {...common} />;
  }
}

import { useMemo, useRef } from "react";
import { parseStepsConfig, stepIndexForNode, withDefaultMessageCounts, truncateSequence } from "@kw/lib/stepsBlock";
import { usePlayback } from "@kw/widgets/usePlayback";
import { PlaybackControls } from "@kw/widgets/PlaybackControls";
import { AnnotationBar } from "@kw/widgets/AnnotationBar";
import { CodeHighlight } from "@kw/widgets/CodeHighlight";
import { MermaidDiagram } from "./MermaidDiagram";

type Props = {
  source: string;
  onNavigate?: (path: string) => void;
};

export function KiwiSteps({ source, onNavigate }: Props) {
  const parsed = useMemo(() => {
    try {
      const config = parseStepsConfig(source);
      return { config, error: null as string | null };
    } catch (err) {
      return { config: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [source]);

  const steps = useMemo(() => {
    if (!parsed.config) return [];
    return withDefaultMessageCounts(parsed.config).map((spec) => ({
      state: spec,
      label: spec.note || "",
      breakpoint: spec.breakpoint,
    }));
  }, [parsed.config]);

  const boxRef = useRef<HTMLDivElement>(null);
  const pb = usePlayback(steps.length ? steps : [{ state: { focus: [], dim: [], note: "" }, label: "" }], boxRef);
  const current = pb.current.state;

  if (parsed.error || !parsed.config) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        Steps error: {parsed.error}
      </div>
    );
  }

  const config = parsed.config;
  const chart = config.kind === "sequence"
    ? truncateSequence(config.diagram, current.messages ?? 1)
    : config.diagram;

  return (
    <div ref={boxRef} className="kiwi-steps" tabIndex={0}>
      <MermaidDiagram
        chart={chart}
        focus={current.focus}
        dim={current.dim}
        onNavigate={onNavigate}
        onNodeClick={(id) => {
          const idx = stepIndexForNode(config.steps, id);
          if (idx >= 0) pb.setCurrentStep(idx);
        }}
      />
      {current.note && (
        <AnnotationBar text={current.note} label={`Step ${pb.currentStep + 1}`} />
      )}
      {config.code && (
        <CodeHighlight
          code={config.code}
          lang={config.lang || "text"}
          activeLine={current.line != null ? current.line - 1 : undefined}
        />
      )}
      <PlaybackControls
        currentStep={pb.currentStep}
        totalSteps={pb.totalSteps}
        playing={pb.playing}
        speed={pb.speed}
        onPlay={pb.play}
        onStop={pb.stop}
        onStepForward={pb.stepForward}
        onStepBack={pb.stepBack}
        onReset={pb.reset}
        onSeek={pb.setCurrentStep}
        onCycleSpeed={pb.cycleSpeed}
      />
    </div>
  );
}

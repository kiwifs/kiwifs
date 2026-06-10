import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { LiveProvider, LivePreview, LiveError } from "react-live";
import yaml from "js-yaml";
import { getWidget } from "@kw/widgets/registry";
import { usePlayback } from "@kw/widgets/usePlayback";
import { PlaybackControls } from "@kw/widgets/PlaybackControls";
import { ErrorBoundary } from "./ErrorBoundary";

const liveScope = {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  usePlayback,
  PlaybackControls,
};

interface Props {
  name: string;
  source: string;
}

export function KiwiWidget({ name, source }: Props) {
  if (name === "live") {
    return (
      <ErrorBoundary fallback={<WidgetError name={name} source={source} />}>
        <div className="my-4 rounded-lg border border-border overflow-hidden">
          <LiveProvider code={source} scope={liveScope} noInline>
            <div className="p-4 bg-card">
              <LivePreview />
            </div>
            <LiveError className="px-4 py-2 text-sm font-mono text-destructive bg-destructive/10 border-t border-border whitespace-pre-wrap" />
          </LiveProvider>
        </div>
      </ErrorBoundary>
    );
  }

  const Widget = getWidget(name);
  if (Widget) {
    let config: Record<string, unknown> = {};
    try { config = (yaml.load(source) as Record<string, unknown>) ?? {}; } catch {}
    return (
      <ErrorBoundary fallback={<WidgetError name={name} source={source} />}>
        <Widget config={config} />
      </ErrorBoundary>
    );
  }

  return (
    <div className="my-4 p-4 rounded-lg border border-border bg-card">
      <p className="text-sm text-muted-foreground mb-2">
        Unknown widget: <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{name}</code>
      </p>
      <pre className="text-xs font-mono bg-muted p-3 rounded overflow-auto"><code>{source}</code></pre>
    </div>
  );
}

function WidgetError({ name, source }: { name: string; source: string }) {
  return (
    <pre className="kiwi-widget-error">
      <code>{`Widget "${name}" threw an error\n\n${source}`}</code>
    </pre>
  );
}

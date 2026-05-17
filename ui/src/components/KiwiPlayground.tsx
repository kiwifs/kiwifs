/**
 * KiwiPlayground — Interactive parameter tuning component.
 *
 * Renders interactive controls (sliders, toggles, selects, color pickers,
 * number inputs) from a YAML/JSON DSL. Supports:
 * - Live parameter adjustment
 * - Copy as JSON / Copy as prompt
 * - Reset to defaults
 * - Optional live CSS/SVG preview
 *
 * Config format:
 * ```kiwi-playground
 * title: Animation Tuning
 * widgets:
 *   - type: slider
 *     key: duration
 *     label: Duration (ms)
 *     min: 100
 *     max: 2000
 *     step: 50
 *     default: 500
 *   - type: toggle
 *     key: loop
 *     label: Loop Animation
 *     default: true
 *   - type: select
 *     key: easing
 *     label: Easing Function
 *     options: [linear, ease-in, ease-out, ease-in-out]
 *     default: ease-out
 *   - type: color
 *     key: accent
 *     label: Accent Color
 *     default: "#3b82f6"
 * export:
 *   format: json
 *   copyLabel: Copy Config
 * ```
 */

import React, { useMemo, useState, useCallback } from "react";
import { HexColorPicker } from "react-colorful";
import yaml from "js-yaml";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@kw/components/ui/select";

// ── Types ────────────────────────────────────────────────────────────────────

interface SliderWidget {
  type: "slider";
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  default: number;
}

interface ToggleWidget {
  type: "toggle";
  key: string;
  label: string;
  default: boolean;
}

interface SelectWidget {
  type: "select";
  key: string;
  label: string;
  options: string[];
  default: string;
}

interface ColorWidget {
  type: "color";
  key: string;
  label: string;
  default: string;
}

interface NumberWidget {
  type: "number";
  key: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  default: number;
}

interface TextWidget {
  type: "text";
  key: string;
  label: string;
  default: string;
  placeholder?: string;
}

type Widget = SliderWidget | ToggleWidget | SelectWidget | ColorWidget | NumberWidget | TextWidget;

interface ExportConfig {
  format?: "json" | "yaml" | "prompt";
  copyLabel?: string;
  promptTemplate?: string;
}

interface PlaygroundConfig {
  title?: string;
  widgets: Widget[];
  export?: ExportConfig;
  preview?: "css" | "svg" | null;
  previewTemplate?: string;
}

// ── Parser ───────────────────────────────────────────────────────────────────

function parsePlaygroundConfig(source: string): PlaygroundConfig {
  const trimmed = source.trim();

  // Try JSON
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as PlaygroundConfig;
  }

  // YAML-like parser
  let title: string | undefined;
  let exportConfig: ExportConfig = {};
  let preview: "css" | "svg" | null = null;
  let previewTemplate: string | undefined;
  const widgets: Widget[] = [];

  const lines = trimmed.split("\n");
  let section: "root" | "widgets" | "widget-item" | "export" = "root";
  let currentWidget: Record<string, unknown> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;

    if (l.startsWith("title:")) {
      title = l.slice(6).trim().replace(/^["']|["']$/g, "");
      section = "root";
    } else if (l.startsWith("preview:")) {
      const v = l.slice(8).trim().replace(/^["']|["']$/g, "");
      preview = v === "css" || v === "svg" ? v : null;
      section = "root";
    } else if (l.startsWith("previewTemplate:")) {
      previewTemplate = l.slice(16).trim().replace(/^["']|["']$/g, "");
      section = "root";
    } else if (l === "widgets:") {
      section = "widgets";
    } else if (l === "export:") {
      section = "export";
    } else if (section === "export") {
      const kvMatch = l.match(/^([A-Za-z]+):\s*(.*)$/);
      if (kvMatch) {
        const [, k, v] = kvMatch;
        (exportConfig as any)[k] = v.trim().replace(/^["']|["']$/g, "");
      }
    } else if (section === "widgets" || section === "widget-item") {
      if (l.startsWith("- ")) {
        // Flush previous widget
        if (currentWidget.type && currentWidget.key) {
          widgets.push(finalizeWidget(currentWidget));
        }
        currentWidget = {};
        section = "widget-item";
        const inlineKv = l.slice(2).trim();
        const kvMatch = inlineKv.match(/^([A-Za-z]+):\s*(.*)$/);
        if (kvMatch) {
          setWidgetField(currentWidget, kvMatch[1], kvMatch[2]);
        }
      } else if (indent > 2 || section === "widget-item") {
        const kvMatch = l.match(/^([A-Za-z]+):\s*(.*)$/);
        if (kvMatch) {
          setWidgetField(currentWidget, kvMatch[1], kvMatch[2]);
        }
      }
    }
  }

  // Flush last widget
  if (currentWidget.type && currentWidget.key) {
    widgets.push(finalizeWidget(currentWidget));
  }

  return { title, widgets, export: exportConfig, preview, previewTemplate };
}

function setWidgetField(widget: Record<string, unknown>, key: string, val: string) {
  const v = val.trim();
  switch (key) {
    case "type":
    case "key":
    case "label":
    case "placeholder":
    case "promptTemplate":
      widget[key] = v.replace(/^["']|["']$/g, "");
      break;
    case "min":
    case "max":
    case "step":
      widget[key] = parseFloat(v);
      break;
    case "default":
      if (v === "true") widget[key] = true;
      else if (v === "false") widget[key] = false;
      else if (/^-?\d+(\.\d+)?$/.test(v)) widget[key] = parseFloat(v);
      else widget[key] = v.replace(/^["']|["']$/g, "");
      break;
    case "options":
      // Parse inline array: [a, b, c]
      if (v.startsWith("[") && v.endsWith("]")) {
        widget[key] = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
      }
      break;
  }
}

function finalizeWidget(raw: Record<string, unknown>): Widget {
  return raw as unknown as Widget;
}

// ── Defaults extractor ───────────────────────────────────────────────────────

function getDefaults(widgets: Widget[]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const w of widgets) {
    defaults[w.key] = w.default;
  }
  return defaults;
}

// ── Component ────────────────────────────────────────────────────────────────

export function KiwiPlayground({ source }: { source: string }) {
  const { config, error } = useMemo(() => {
    try {
      const cfg = parsePlaygroundConfig(source);
      if (!cfg.widgets || cfg.widgets.length === 0) {
        return { config: null, error: "No widgets defined" };
      }
      return { config: cfg, error: null };
    } catch (e) {
      return { config: null, error: e instanceof Error ? e.message : "Failed to parse playground config" };
    }
  }, [source]);

  const defaults = useMemo(() => (config ? getDefaults(config.widgets) : {}), [config]);
  const [values, setValues] = useState<Record<string, unknown>>(defaults);
  const [copied, setCopied] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState<string | null>(null);

  const handleChange = useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleReset = useCallback(() => {
    setValues(defaults);
  }, [defaults]);

  const handleCopy = useCallback(async () => {
    if (!config) return;
    const format = config.export?.format || "json";
    let text: string;

    if (format === "prompt" && config.export?.promptTemplate) {
      text = config.export.promptTemplate;
      for (const [k, v] of Object.entries(values)) {
        text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
      }
    } else if (format === "yaml") {
      text = yaml.dump(values, { indent: 2, lineWidth: 120 });
    } else {
      text = JSON.stringify(values, null, 2);
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [config, values]);

  if (error || !config) {
    return (
      <div className="kiwi-playground-error rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        <strong>Playground Error:</strong> {error}
      </div>
    );
  }

  return (
    <div className="kiwi-playground not-prose my-4 rounded-md border border-border overflow-hidden">
      {/* Header */}
      {config.title && (
        <div className="border-b border-border bg-muted/30 px-4 py-2">
          <h4 className="text-sm font-medium text-foreground">{config.title}</h4>
        </div>
      )}

      {/* Widgets */}
      <div className="p-4 space-y-4">
        {config.widgets.map((widget) => (
          <WidgetRenderer
            key={widget.key}
            widget={widget}
            value={values[widget.key]}
            onChange={(v) => handleChange(widget.key, v)}
            colorPickerOpen={colorPickerOpen}
            setColorPickerOpen={setColorPickerOpen}
          />
        ))}
      </div>

      {/* Preview area (optional) */}
      {config.preview && config.previewTemplate && (
        <div className="border-t border-border p-4 bg-muted/10">
          <PreviewPane
            type={config.preview}
            template={config.previewTemplate}
            values={values}
          />
        </div>
      )}

      {/* Actions */}
      <div className="border-t border-border bg-muted/30 px-4 py-2 flex gap-2 justify-end">
        <button
          onClick={handleReset}
          className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
        >
          Reset
        </button>
        <button
          onClick={handleCopy}
          className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          {copied ? "Copied!" : config.export?.copyLabel || "Copy as JSON"}
        </button>
      </div>
    </div>
  );
}

// ── Widget Renderers ─────────────────────────────────────────────────────────

interface WidgetRendererProps {
  widget: Widget;
  value: unknown;
  onChange: (value: unknown) => void;
  colorPickerOpen: string | null;
  setColorPickerOpen: (key: string | null) => void;
}

function WidgetRenderer({ widget, value, onChange, colorPickerOpen, setColorPickerOpen }: WidgetRendererProps) {
  switch (widget.type) {
    case "slider":
      return <SliderControl widget={widget} value={value as number} onChange={onChange} />;
    case "toggle":
      return <ToggleControl widget={widget} value={value as boolean} onChange={onChange} />;
    case "select":
      return <SelectControl widget={widget} value={value as string} onChange={onChange} />;
    case "color":
      return (
        <ColorControl
          widget={widget}
          value={value as string}
          onChange={onChange}
          isOpen={colorPickerOpen === widget.key}
          onToggle={() => setColorPickerOpen(colorPickerOpen === widget.key ? null : widget.key)}
        />
      );
    case "number":
      return <NumberControl widget={widget} value={value as number} onChange={onChange} />;
    case "text":
      return <TextControl widget={widget} value={value as string} onChange={onChange} />;
    default:
      return null;
  }
}

function SliderControl({ widget, value, onChange }: { widget: SliderWidget; value: number; onChange: (v: number) => void }) {
  return (
    <div className="kiwi-widget-slider space-y-1">
      <div className="flex justify-between">
        <label className="text-sm font-medium text-foreground">{widget.label}</label>
        <span className="text-xs font-mono text-muted-foreground">{value ?? widget.default}</span>
      </div>
      <input
        type="range"
        min={widget.min}
        max={widget.max}
        step={widget.step || 1}
        value={value ?? widget.default}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{widget.min}</span>
        <span>{widget.max}</span>
      </div>
    </div>
  );
}

function ToggleControl({ widget, value, onChange }: { widget: ToggleWidget; value: boolean; onChange: (v: boolean) => void }) {
  const checked = value ?? widget.default;
  return (
    <div className="kiwi-widget-toggle flex items-center justify-between">
      <label className="text-sm font-medium text-foreground">{widget.label}</label>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors
          ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform shadow-sm
            ${checked ? "translate-x-4.5" : "translate-x-0.5"}`}
        />
      </button>
    </div>
  );
}

function SelectControl({ widget, value, onChange }: { widget: SelectWidget; value: string; onChange: (v: string) => void }) {
  return (
    <div className="kiwi-widget-select space-y-1">
      <label className="text-sm font-medium text-foreground">{widget.label}</label>
      <Select value={value ?? widget.default} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {widget.options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ColorControl({
  widget, value, onChange, isOpen, onToggle,
}: {
  widget: ColorWidget; value: string; onChange: (v: string) => void; isOpen: boolean; onToggle: () => void;
}) {
  const currentValue = (value ?? widget.default) as string;
  return (
    <div className="kiwi-widget-color space-y-1">
      <label className="text-sm font-medium text-foreground">{widget.label}</label>
      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          className="h-8 w-8 rounded-md border border-border shadow-sm"
          style={{ backgroundColor: currentValue }}
          title="Click to open color picker"
        />
        <input
          type="text"
          value={currentValue}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>
      {isOpen && (
        <div className="mt-2">
          <HexColorPicker color={currentValue} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function NumberControl({ widget, value, onChange }: { widget: NumberWidget; value: number; onChange: (v: number) => void }) {
  return (
    <div className="kiwi-widget-number space-y-1">
      <label className="text-sm font-medium text-foreground">{widget.label}</label>
      <input
        type="number"
        min={widget.min}
        max={widget.max}
        step={widget.step || 1}
        value={value ?? widget.default}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
    </div>
  );
}

function TextControl({ widget, value, onChange }: { widget: TextWidget; value: string; onChange: (v: string) => void }) {
  return (
    <div className="kiwi-widget-text space-y-1">
      <label className="text-sm font-medium text-foreground">{widget.label}</label>
      <input
        type="text"
        value={value ?? widget.default}
        placeholder={widget.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
    </div>
  );
}

// ── Preview Pane ─────────────────────────────────────────────────────────────

function PreviewPane({ type, template, values }: { type: "css" | "svg"; template: string; values: Record<string, unknown> }) {
  const rendered = useMemo(() => {
    let result = template;
    for (const [k, v] of Object.entries(values)) {
      result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
    }
    return result;
  }, [template, values]);

  if (type === "css") {
    return (
      <div className="kiwi-playground-preview">
        <div
          className="w-full h-24 rounded-md border border-border flex items-center justify-center"
          style={parseCssPreview(rendered)}
        >
          <span className="text-sm text-muted-foreground">Preview</span>
        </div>
      </div>
    );
  }

  if (type === "svg") {
    return (
      <div
        className="kiwi-playground-preview flex items-center justify-center"
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    );
  }

  return null;
}

function parseCssPreview(css: string): React.CSSProperties {
  const style: Record<string, string> = {};
  const pairs = css.split(";").filter(Boolean);
  for (const pair of pairs) {
    const [prop, val] = pair.split(":").map((s) => s.trim());
    if (prop && val) {
      // Convert kebab-case to camelCase
      const camelProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      style[camelProp] = val;
    }
  }
  return style as React.CSSProperties;
}

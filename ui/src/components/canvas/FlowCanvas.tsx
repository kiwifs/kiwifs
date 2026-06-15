// FlowCanvas — React Flow renderer for JSON Canvas documents.
// Full authoring: node CRUD, edge CRUD, inline editing, resize, context menus,
// undo/redo, keyboard shortcuts, drag-to-connect, and color presets.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  LayoutGrid,
  Loader2,
  Plus,
  Save,
  Trash2,
  Type,
  Link as LinkIcon,
  Group,
  Undo2,
  Redo2,
  Palette,
  Copy,
  FileText,
} from "lucide-react";
import { Button } from "@kw/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@kw/components/ui/popover";
import { api, sseUrl, type TreeEntry } from "@kw/lib/api";
import { applyDagreLayout } from "@kw/lib/canvasLayout";
import {
  getCanvasMarkdownDragPath,
  normalizeDroppedMarkdownPath,
} from "@kw/lib/canvasMarkdownDrag";
import { useCanvasMarkdownUiStore } from "@kw/stores/canvasMarkdownUiStore";
import { KiwiSearch } from "../KiwiSearch";
import CanvasTextNode from "./CanvasTextNode";
import CanvasFileNode from "./CanvasFileNode";
import CanvasLinkNode from "./CanvasLinkNode";
import CanvasGroupNode from "./CanvasGroupNode";
import { CanvasMarkdownPagePicker } from "./CanvasMarkdownPagePicker";

// ─── JSON Canvas data types ─────────────────────────────────────────────────

type CanvasNode = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  url?: string;
  color?: string;
};

type CanvasEdge = {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  label?: string;
  color?: string;
};

type CanvasDoc = { nodes: CanvasNode[]; edges: CanvasEdge[] };

// ─── Color presets matching Obsidian Canvas ──────────────────────────────────

const COLOR_PRESETS: { key: string; label: string; hex: string }[] = [
  { key: "1", label: "Red", hex: "#fb464c" },
  { key: "2", label: "Orange", hex: "#e9973f" },
  { key: "3", label: "Yellow", hex: "#e0de71" },
  { key: "4", label: "Green", hex: "#44cf6e" },
  { key: "5", label: "Cyan", hex: "#53dfdd" },
  { key: "6", label: "Purple", hex: "#a882ff" },
];

function resolveColor(color?: string): string | undefined {
  if (!color) return undefined;
  const preset = COLOR_PRESETS.find((p) => p.key === color);
  if (!preset) return color;
  return preset.hex;
}

function unresolveColor(hex?: string): string | undefined {
  if (!hex) return undefined;
  const preset = COLOR_PRESETS.find((p) => p.hex === hex);
  if (!preset) return hex;
  return preset.key;
}

function resolveNodeType(type: string | undefined): string {
  if (type === "file") return "file";
  if (type === "link") return "link";
  if (type === "group") return "group";
  return "text";
}

function edgeStyle(color: string | undefined): Edge["style"] {
  if (!color) return undefined;
  return { stroke: resolveColor(color) };
}

function edgeSidePatch(handleId: string | null | undefined, key: "fromSide" | "toSide"): Partial<CanvasEdge> {
  const side = handleToSide(handleId);
  if (!side) return {};
  return { [key]: side };
}

function edgeLabelPatch(label: unknown): Partial<CanvasEdge> {
  if (!label) return {};
  return { label: String(label) };
}

function edgeColorPatch(style: Edge["style"]): Partial<CanvasEdge> {
  if (!style) return {};
  if (!("stroke" in style)) return {};
  return { color: unresolveColor(String(style.stroke)) };
}

// ─── Handle-side mapping ─────────────────────────────────────────────────────

const SIDE_TO_HANDLE: Record<string, string> = {
  left: "left-target",
  right: "right-source",
  top: "top-target",
  bottom: "bottom-source",
};

const HANDLE_TO_SIDE: Record<string, string> = {
  "left-target": "left",
  "right-source": "right",
  "top-target": "top",
  "bottom-source": "bottom",
};

function sideToHandle(side: string | undefined, _role: "source" | "target"): string | undefined {
  if (!side) return undefined;
  return SIDE_TO_HANDLE[side];
}

function handleToSide(handleId: string | null | undefined): string | undefined {
  if (!handleId) return undefined;
  return HANDLE_TO_SIDE[handleId];
}

// ─── Conversion helpers ─────────────────────────────────────────────────────

function toFlowNodes(
  raw: CanvasNode[],
  onTextChange: (id: string, text: string) => void,
  onNavigate: (path: string) => void,
): Node[] {
  return raw.map((n) => ({
    id: n.id,
    type: resolveNodeType(n.type),
    position: { x: n.x ?? 0, y: n.y ?? 0 },
    data: {
      text: n.text,
      file: n.file,
      url: n.url,
      color: resolveColor(n.color),
      onTextChange,
      onNavigate,
    },
    width: n.width || undefined,
    height: n.height || undefined,
  }));
}

function toFlowEdges(raw: CanvasEdge[]): Edge[] {
  return raw.map((e) => ({
    id: e.id,
    source: e.fromNode,
    target: e.toNode,
    sourceHandle: sideToHandle(e.fromSide, "source"),
    targetHandle: sideToHandle(e.toSide, "target"),
    label: e.label,
    animated: false,
    style: edgeStyle(e.color),
  }));
}

function toCanvasDoc(nodes: Node[], edges: Edge[]): CanvasDoc {
  return {
    nodes: nodes.map((n) => {
      const { onTextChange, onNavigate, ...rest } = n.data as Record<string, unknown>;
      return {
        id: n.id,
        type: n.type ?? "text",
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
        width: Math.round(n.measured?.width ?? n.width ?? 240),
        height: Math.round(n.measured?.height ?? n.height ?? 80),
        ...rest,
        color: unresolveColor(rest.color as string | undefined),
      };
    }),
    edges: edges.map((e) => ({
      id: e.id,
      fromNode: e.source,
      toNode: e.target,
      ...edgeSidePatch(e.sourceHandle, "fromSide"),
      ...edgeSidePatch(e.targetHandle, "toSide"),
      ...edgeLabelPatch(e.label),
      ...edgeColorPatch(e.style),
    })),
  };
}

// ─── Undo/Redo ──────────────────────────────────────────────────────────────

type Snapshot = { nodes: Node[]; edges: Edge[] };

function useHistory(maxSize = 50) {
  const pastRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);

  const push = useCallback(
    (snapshot: Snapshot) => {
      pastRef.current = [...pastRef.current.slice(-(maxSize - 1)), snapshot];
      futureRef.current = []; // clear redo stack on new action
    },
    [maxSize],
  );

  const undo = useCallback(
    (current: Snapshot): Snapshot | null => {
      const prev = pastRef.current.pop();
      if (!prev) return null;
      futureRef.current.push(current);
      return prev;
    },
    [],
  );

  const redo = useCallback(
    (current: Snapshot): Snapshot | null => {
      const next = futureRef.current.pop();
      if (!next) return null;
      pastRef.current.push(current);
      return next;
    },
    [],
  );

  const canUndo = useCallback(() => pastRef.current.length > 0, []);
  const canRedo = useCallback(() => futureRef.current.length > 0, []);

  return { push, undo, redo, canUndo, canRedo };
}

// ─── Node types ──────────────────────────────────────────────────────────────

const nodeTypes = {
  text: CanvasTextNode,
  file: CanvasFileNode,
  link: CanvasLinkNode,
  group: CanvasGroupNode,
};

// ─── ID helpers ──────────────────────────────────────────────────────────────

let idCounter = 0;
function newId(prefix = "n"): string {
  return `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

function canvasCenterPosition(reactFlow: ReturnType<typeof useReactFlow>): XYPosition {
  const viewport = reactFlow.getViewport();
  return {
    x: (window.innerWidth / 2 - viewport.x) / viewport.zoom,
    y: (window.innerHeight / 2 - viewport.y) / viewport.zoom,
  };
}

function updateNodeData(node: Node, nodeId: string, data: Record<string, unknown>): Node {
  if (node.id !== nodeId) return node;
  return { ...node, data: { ...node.data, ...data } };
}

const nodeDefaultsFor = (
  type: "text" | "file" | "link" | "group",
  onTextChange: (id: string, text: string) => void,
  onNavigate: (path: string) => void,
): Record<string, unknown> => {
  const callbacks = { onTextChange, onNavigate };
  if (type === "file") return { file: "", ...callbacks };
  if (type === "link") return { url: "", ...callbacks };
  if (type === "group") return { text: "Group", ...callbacks };
  return { text: "", ...callbacks };
};

const nodeSizeFor = (type: "text" | "file" | "link" | "group") => {
  if (type === "group") return { width: 400, height: 300 };
  return { width: 240, height: 80 };
};

function SaveStatusIcon({ saving }: { saving: boolean }) {
  if (saving) return <Loader2 className="h-3 w-3 animate-spin" />;
  return <Save className="h-3 w-3" />;
}

// ─── Component ───────────────────────────────────────────────────────────────

type Props = {
  path: string;
  onNavigate: (path: string) => void;
  tree?: TreeEntry | null;
};

export function FlowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function FlowCanvasInner({ path, onNavigate, tree = null }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasDropRootRef = useRef<HTMLDivElement | null>(null);
  const suppressSSERef = useRef(false);
  const initialLoadRef = useRef(true);
  const history = useHistory();
  const addMenuOpen = useCanvasMarkdownUiStore((state) => state.addMenuOpen);
  const markdownSearchOpen = useCanvasMarkdownUiStore((state) => state.searchOpen);
  const setAddMenuOpen = useCanvasMarkdownUiStore((state) => state.setAddMenuOpen);
  const openMarkdownSearch = useCanvasMarkdownUiStore((state) => state.openMarkdownSearch);
  const closeMarkdownSearch = useCanvasMarkdownUiStore((state) => state.closeMarkdownSearch);
  const closeCanvasMarkdownMenus = useCanvasMarkdownUiStore((state) => state.closeMenus);
  const recordMarkdownDropIfFresh = useCanvasMarkdownUiStore((state) => state.recordDropIfFresh);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{
    type: "canvas" | "node" | "edge";
    x: number;
    y: number;
    flowPos?: XYPosition;
    nodeId?: string;
    edgeId?: string;
  } | null>(null);

  const reactFlow = useReactFlow();

  // ── Text change callback (passed down to CanvasTextNode) ────────────────

  const handleTextChange = useCallback(
    (nodeId: string, text: string) => {
      setNodes((nds) => {
        history.push({ nodes: nds, edges: edgesRef.current });
        return nds.map((n) => updateNodeData(n, nodeId, { text }));
      });
      scheduleAutosave();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── Navigate callback (passed down to CanvasFileNode) ────────────────

  const handleNodeNavigate = useCallback(
    (filePath: string) => onNavigate(filePath),
    [onNavigate],
  );

  // ── Load canvas ─────────────────────────────────────────────────────────

  const loadCanvas = useCallback(async () => {
    try {
      const data = await api.getCanvas(path);
      const doc = data as unknown as CanvasDoc;
      const flowNodes = toFlowNodes(doc.nodes ?? [], handleTextChange, handleNodeNavigate);
      const flowEdges = toFlowEdges(doc.edges ?? []);
      setNodes(flowNodes);
      setEdges(flowEdges);
    } catch {
      setNodes([]);
      setEdges([]);
    } finally {
      setLoading(false);
    }
  }, [path, setNodes, setEdges, handleTextChange, handleNodeNavigate]);

  useEffect(() => {
    loadCanvas();
  }, [loadCanvas]);

  // ── SSE live reload ─────────────────────────────────────────────────────

  useEffect(() => {
    const es = new EventSource(sseUrl());
    const onWrite = (ev: MessageEvent) => {
      if (suppressSSERef.current) return;
      try {
        const data = JSON.parse(ev.data);
        if (data.path === path) loadCanvas();
      } catch { /* ignore */ }
    };
    es.addEventListener("write", onWrite);
    return () => {
      es.removeEventListener("write", onWrite);
      es.close();
    };
  }, [path, loadCanvas]);

  // ── Save ────────────────────────────────────────────────────────────────

  // Use refs so save always has latest nodes/edges
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const save = useCallback(async () => {
    setSaving(true);
    suppressSSERef.current = true;
    try {
      const doc = toCanvasDoc(nodesRef.current, edgesRef.current);
      await api.saveCanvas(path, doc as unknown as Record<string, unknown>);
    } catch (e) {
      console.error("Canvas save failed:", e);
    } finally {
      setSaving(false);
      setTimeout(() => { suppressSSERef.current = false; }, 1000);
    }
  }, [path]);

  // ── Auto-save (debounced) ────────────────────────────────────────────────

  const scheduleAutosave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(save, 1500);
  }, [save]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);

      if (initialLoadRef.current) {
        const onlyDimensions = changes.every((c) => c.type === "dimensions");
        if (onlyDimensions) return;
        initialLoadRef.current = false;
      }

      const shouldSave = changes.some(
        (c) =>
          (c.type === "position" && "dragging" in c && !c.dragging) ||
          (c.type === "dimensions" && "resizing" in c && !(c as any).resizing),
      );
      if (shouldSave) {
        history.push({ nodes: nodesRef.current, edges: edgesRef.current });
        scheduleAutosave();
      }
    },
    [onNodesChange, scheduleAutosave, history],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes);
      if (changes.some((c) => c.type === "remove")) {
        history.push({ nodes: nodesRef.current, edges: edgesRef.current });
        scheduleAutosave();
      }
    },
    [onEdgesChange, scheduleAutosave, history],
  );

  // ── Edge creation ──────────────────────────────────────────────────────

  const onConnect = useCallback(
    (connection: Connection) => {
      history.push({ nodes: nodesRef.current, edges: edgesRef.current });
      const newEdge: Edge = {
        id: newId("e"),
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        animated: false,
        type: "smoothstep",
      };
      setEdges((eds) => addEdge(newEdge, eds));
      scheduleAutosave();
    },
    [setEdges, scheduleAutosave, history],
  );

  // ── Node creation ──────────────────────────────────────────────────────

  const createNode = useCallback(
    (type: "text" | "file" | "link" | "group", position: XYPosition, extraData?: Record<string, unknown>) => {
      history.push({ nodes: nodesRef.current, edges: edgesRef.current });
      const id = newId("n");
      const data = {
        ...nodeDefaultsFor(type, handleTextChange, handleNodeNavigate),
        ...extraData,
      };
      const newNode: Node = {
        id,
        type,
        position,
        data,
        ...nodeSizeFor(type),
      };
      setNodes((nds) => [...nds, newNode]);
      scheduleAutosave();
      return id;
    },
    [setNodes, scheduleAutosave, history, handleTextChange, handleNodeNavigate],
  );

  const addMarkdownPageAt = useCallback(
    (filePath: string, position: XYPosition) => {
      const normalized = filePath.trim();
      if (!normalized) return;
      createNode("file", position, { file: normalized });
      closeCanvasMarkdownMenus();
    },
    [createNode, closeCanvasMarkdownMenus],
  );

  const handleAddMenuOpenChange = useCallback(
    (open: boolean) => {
      setAddMenuOpen(open);
    },
    [setAddMenuOpen],
  );

  const addTextAtCenter = useCallback(() => {
    createNode("text", canvasCenterPosition(reactFlow));
    setAddMenuOpen(false);
  }, [createNode, reactFlow, setAddMenuOpen]);

  const addSelectedMarkdownPage = useCallback(
    (page: string) => addMarkdownPageAt(page, canvasCenterPosition(reactFlow)),
    [addMarkdownPageAt, reactFlow],
  );

  const addLinkFromPrompt = useCallback(() => {
    const url = window.prompt("Enter URL:");
    if (!url) return;
    createNode("link", canvasCenterPosition(reactFlow), { url });
    setAddMenuOpen(false);
  }, [createNode, reactFlow, setAddMenuOpen]);

  const addGroupAtCenter = useCallback(() => {
    createNode("group", canvasCenterPosition(reactFlow));
    setAddMenuOpen(false);
  }, [createNode, reactFlow, setAddMenuOpen]);

  const handleMarkdownPageDrop = useCallback(
    (event: DragEvent | React.DragEvent) => {
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) return false;
      const filePath = normalizeDroppedMarkdownPath(dataTransfer);
      if (!filePath) return false;

      event.preventDefault();
      event.stopPropagation();

      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const key = `${filePath}:${Math.round(position.x)}:${Math.round(position.y)}`;
      if (!recordMarkdownDropIfFresh(key, Date.now())) return true;

      addMarkdownPageAt(filePath, position);
      return true;
    },
    [reactFlow, addMarkdownPageAt, recordMarkdownDropIfFresh],
  );

  useEffect(() => {
    const isInsideCanvas = (target: EventTarget | null) =>
      target instanceof Node && canvasDropRootRef.current?.contains(target);

    const acceptMarkdownDrag = (event: DragEvent) => {
      if (!isInsideCanvas(event.target) || !getCanvasMarkdownDragPath()) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };

    const onDropCapture = (event: DragEvent) => {
      if (!isInsideCanvas(event.target)) return;
      handleMarkdownPageDrop(event);
    };

    window.addEventListener("dragenter", acceptMarkdownDrag, true);
    window.addEventListener("dragover", acceptMarkdownDrag, true);
    window.addEventListener("drop", onDropCapture, true);
    return () => {
      window.removeEventListener("dragenter", acceptMarkdownDrag, true);
      window.removeEventListener("dragover", acceptMarkdownDrag, true);
      window.removeEventListener("drop", onDropCapture, true);
    };
  }, [handleMarkdownPageDrop]);

  // Double-click canvas background → new text card
  const onPaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      createNode("text", position);
    },
    [reactFlow, createNode],
  );

  // ── Paste URL → link card ──────────────────────────────────────────────

  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || (e.target as HTMLElement)?.isContentEditable) return;

      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;

      try {
        new URL(text); // validates as URL
      } catch {
        return; // not a URL
      }

      e.preventDefault();
      const viewport = reactFlow.getViewport();
      const center: XYPosition = {
        x: (window.innerWidth / 2 - viewport.x) / viewport.zoom,
        y: (window.innerHeight / 2 - viewport.y) / viewport.zoom,
      };
      createNode("link", center, { url: text });
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [reactFlow, createNode]);

  // ── Drop from file tree ────────────────────────────────────────────────

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      handleMarkdownPageDrop(event);
    },
    [handleMarkdownPageDrop],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const addMarkdownPageNode = useCallback(
    (position: XYPosition) => {
      const filePath = window.prompt("Markdown page path (example: Notes/Overview.md):")?.trim();
      if (!filePath) return;
      addMarkdownPageAt(filePath, position);
    },
    [addMarkdownPageAt],
  );

  // ── Delete selected ────────────────────────────────────────────────────

  const deleteSelected = useCallback(() => {
    history.push({ nodes: nodesRef.current, edges: edgesRef.current });
    setNodes((nds) => {
      const selectedIds = new Set(nds.filter((n) => n.selected).map((n) => n.id));
      if (selectedIds.size === 0) {
        // Maybe edges are selected
        setEdges((eds) => eds.filter((e) => !e.selected));
        scheduleAutosave();
        return nds;
      }
      // Remove edges connected to deleted nodes
      setEdges((eds) =>
        eds.filter((e) => !selectedIds.has(e.source) && !selectedIds.has(e.target) && !e.selected),
      );
      scheduleAutosave();
      return nds.filter((n) => !n.selected);
    });
  }, [setNodes, setEdges, scheduleAutosave, history]);

  // ── Duplicate selected ──────────────────────────────────────────────────

  const duplicateSelected = useCallback(() => {
    history.push({ nodes: nodesRef.current, edges: edgesRef.current });
    const selected = nodesRef.current.filter((n) => n.selected);
    if (selected.length === 0) return;

    const idMap = new Map<string, string>();
    const offset = 30;

    const newNodes = selected.map((n) => {
      const nid = newId("n");
      idMap.set(n.id, nid);
      return {
        ...n,
        id: nid,
        position: { x: n.position.x + offset, y: n.position.y + offset },
        selected: true,
        data: { ...n.data, onTextChange: handleTextChange, onNavigate: handleNodeNavigate },
      };
    });

    // Duplicate edges between selected nodes
    const selectedIds = new Set(selected.map((n) => n.id));
    const newEdges = edgesRef.current
      .filter((e) => selectedIds.has(e.source) && selectedIds.has(e.target))
      .map((e) => ({
        ...e,
        id: newId("e"),
        source: idMap.get(e.source) ?? e.source,
        target: idMap.get(e.target) ?? e.target,
      }));

    // Deselect old nodes
    setNodes((nds) => [
      ...nds.map((n) => ({ ...n, selected: false })),
      ...newNodes,
    ]);
    setEdges((eds) => [...eds, ...newEdges]);
    scheduleAutosave();
  }, [setNodes, setEdges, scheduleAutosave, history, handleTextChange, handleNodeNavigate]);

  // ── Color change ────────────────────────────────────────────────────────

  const setNodeColor = useCallback(
    (nodeId: string, color: string | undefined) => {
      history.push({ nodes: nodesRef.current, edges: edgesRef.current });
      setNodes((nds) => nds.map((n) => updateNodeData(n, nodeId, { color })));
      scheduleAutosave();
    },
    [setNodes, scheduleAutosave, history],
  );

  // ── Context menu handlers ──────────────────────────────────────────────

  const onPaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
      const flowPos = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      setCtxMenu({ type: "canvas", x: event.clientX, y: event.clientY, flowPos });
    },
    [reactFlow],
  );

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      setCtxMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId: node.id });
    },
    [],
  );

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      setCtxMenu({ type: "edge", x: event.clientX, y: event.clientY, edgeId: edge.id });
    },
    [],
  );

  const closeContextMenu = useCallback(() => setCtxMenu(null), []);

  // ── Auto-layout ─────────────────────────────────────────────────────────

  const handleAutoLayout = useCallback(() => {
    history.push({ nodes: nodesRef.current, edges: edgesRef.current });
    const { nodes: laid, edges: laidEdges } = applyDagreLayout(nodes, edges, "TB");
    setNodes(laid);
    setEdges(laidEdges);
    scheduleAutosave();
  }, [nodes, edges, setNodes, setEdges, scheduleAutosave, history]);

  // ── Undo / Redo buttons ─────────────────────────────────────────────────

  const reattachCallbacks = useCallback(
    (snapshotNodes: Node[]) =>
      snapshotNodes.map((n) => ({
        ...n,
        data: { ...n.data, onTextChange: handleTextChange, onNavigate: handleNodeNavigate },
      })),
    [handleTextChange, handleNodeNavigate],
  );

  const handleUndo = useCallback(() => {
    const snapshot = history.undo({ nodes: nodesRef.current, edges: edgesRef.current });
    if (snapshot) {
      setNodes(reattachCallbacks(snapshot.nodes));
      setEdges(snapshot.edges);
      scheduleAutosave();
    }
  }, [history, setNodes, setEdges, scheduleAutosave, reattachCallbacks]);

  const handleRedo = useCallback(() => {
    const snapshot = history.redo({ nodes: nodesRef.current, edges: edgesRef.current });
    if (snapshot) {
      setNodes(reattachCallbacks(snapshot.nodes));
      setEdges(snapshot.edges);
      scheduleAutosave();
    }
  }, [history, setNodes, setEdges, scheduleAutosave, reattachCallbacks]);

  const handleUndoOrRedo = useCallback(
    (shiftKey: boolean) => {
      if (shiftKey) {
        handleRedo();
        return;
      }
      handleUndo();
    },
    [handleRedo, handleUndo],
  );

  // ── Keyboard shortcuts ──────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
        return;
      }

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleUndoOrRedo(e.shiftKey);
        return;
      }

      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
        setEdges((eds) => eds.map((ed) => ({ ...ed, selected: true })));
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || (e.target as HTMLElement)?.isContentEditable) return;
        e.preventDefault();
        deleteSelected();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, handleUndoOrRedo, setNodes, setEdges, deleteSelected]);

  const proOptions = useMemo(() => ({ hideAttribution: true }), []);

  if (loading) {
    return (
      <div className="h-full grid place-items-center text-muted-foreground">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading canvas...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" onClick={closeContextMenu}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-1.5">
          {/* Add node menu */}
          <Popover
            open={addMenuOpen}
            onOpenChange={handleAddMenuOpenChange}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1 h-7 text-xs">
                <Plus className="h-3 w-3" /> Add
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-1">
              <button
                className="w-full px-3 py-1.5 text-left text-sm rounded hover:bg-accent flex items-center gap-2"
                onClick={addTextAtCenter}
              >
                <Type className="h-3.5 w-3.5" /> Text card
              </button>
              <CanvasMarkdownPagePicker onOpenSearch={openMarkdownSearch} />
              <button
                className="w-full px-3 py-1.5 text-left text-sm rounded hover:bg-accent flex items-center gap-2"
                onClick={addLinkFromPrompt}
              >
                <LinkIcon className="h-3.5 w-3.5" /> Link card
              </button>
              <button
                className="w-full px-3 py-1.5 text-left text-sm rounded hover:bg-accent flex items-center gap-2"
                onClick={addGroupAtCenter}
              >
                <Group className="h-3.5 w-3.5" /> Group
              </button>
            </PopoverContent>
          </Popover>
        </div>

        <div className="ml-2 hidden text-xs text-muted-foreground md:block">
          Tip: drag Markdown pages from the file tree, or use Add → Markdown page and pick from native search.
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleUndo} title="Undo (Ctrl+Z)">
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleRedo} title="Redo (Ctrl+Shift+Z)">
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={handleAutoLayout}>
            <LayoutGrid className="h-3 w-3" /> Auto-layout
          </Button>
          <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={save} disabled={saving}>
            <SaveStatusIcon saving={saving} />
            Save
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div ref={canvasDropRootRef} className="flex-1" onDoubleClick={onPaneDoubleClick}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onPaneContextMenu={onPaneContextMenu}
          onNodeContextMenu={onNodeContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          nodeTypes={nodeTypes}
          proOptions={proOptions}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={4}
          defaultEdgeOptions={{ animated: false, type: "smoothstep" }}
          deleteKeyCode={null}
          selectionOnDrag
          panOnDrag={[1]}
          selectNodesOnDrag={false}
          connectionLineType={ConnectionLineType.SmoothStep}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeStrokeWidth={2}
            pannable
            zoomable
            className="!bg-card !border-border"
          />
        </ReactFlow>
      </div>


      <KiwiSearch
        open={markdownSearchOpen}
        onOpenChange={(open) => {
          if (!open) closeMarkdownSearch();
        }}
        onSelect={addSelectedMarkdownPage}
        tree={tree}
        mode="markdown-page-picker"
      />

      {/* Context Menu */}
      {ctxMenu && (
        <ContextMenuOverlay
          menu={ctxMenu}
          onClose={closeContextMenu}
          createNode={createNode}
          addMarkdownPageNode={addMarkdownPageNode}
          duplicateSelected={duplicateSelected}
          setNodeColor={setNodeColor}
          deleteEdge={(edgeId: string) => {
            history.push({ nodes: nodesRef.current, edges: edgesRef.current });
            setEdges((eds) => eds.filter((e) => e.id !== edgeId));
            scheduleAutosave();
          }}
          deleteNode={(nodeId: string) => {
            history.push({ nodes: nodesRef.current, edges: edgesRef.current });
            setNodes((nds) => nds.filter((n) => n.id !== nodeId));
            setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
            scheduleAutosave();
          }}
        />
      )}
    </div>
  );
}

// ─── Context Menu Component ──────────────────────────────────────────────────

function ContextMenuOverlay({
  menu,
  onClose,
  createNode,
  addMarkdownPageNode,
  duplicateSelected,
  setNodeColor,
  deleteEdge,
  deleteNode,
}: {
  menu: {
    type: "canvas" | "node" | "edge";
    x: number;
    y: number;
    flowPos?: XYPosition;
    nodeId?: string;
    edgeId?: string;
  };
  onClose: () => void;
  createNode: (type: "text" | "file" | "link" | "group", pos: XYPosition, extra?: Record<string, unknown>) => void;
  addMarkdownPageNode: (pos: XYPosition) => void;
  duplicateSelected: () => void;
  setNodeColor: (nodeId: string, color: string | undefined) => void;
  deleteEdge: (edgeId: string) => void;
  deleteNode: (nodeId: string) => void;
}) {
  const style: React.CSSProperties = {
    position: "fixed",
    left: menu.x,
    top: menu.y,
    zIndex: 100,
  };

  if (menu.type === "canvas" && menu.flowPos) {
    return (
      <div style={style} onClick={(e) => e.stopPropagation()}>
        <div className="bg-popover border border-border rounded-md shadow-md py-1 min-w-[160px] text-sm">
          <button
            className="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2"
            onClick={() => { createNode("text", menu.flowPos!); onClose(); }}
          >
            <Type className="h-3.5 w-3.5" /> Add text card
          </button>
          <button
            className="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2"
            onClick={() => { addMarkdownPageNode(menu.flowPos!); onClose(); }}
          >
            <FileText className="h-3.5 w-3.5" /> Add Markdown page
          </button>
          <button
            className="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2"
            onClick={() => {
              const url = window.prompt("Enter URL:");
              if (url) createNode("link", menu.flowPos!, { url });
              onClose();
            }}
          >
            <LinkIcon className="h-3.5 w-3.5" /> Add link card
          </button>
          <button
            className="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2"
            onClick={() => { createNode("group", menu.flowPos!); onClose(); }}
          >
            <Group className="h-3.5 w-3.5" /> Add group
          </button>
        </div>
      </div>
    );
  }

  if (menu.type === "node" && menu.nodeId) {
    return (
      <div style={style} onClick={(e) => e.stopPropagation()}>
        <div className="bg-popover border border-border rounded-md shadow-md py-1 min-w-[160px] text-sm">
          <button
            className="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2"
            onClick={() => { duplicateSelected(); onClose(); }}
          >
            <Copy className="h-3.5 w-3.5" /> Duplicate
          </button>
          <div className="px-3 py-1.5">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Palette className="h-3 w-3" /> Color
            </div>
            <div className="flex gap-1.5">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c.key}
                  className="w-5 h-5 rounded-full border border-border hover:scale-110 transition-transform"
                  style={{ backgroundColor: c.hex }}
                  title={c.label}
                  onClick={() => { setNodeColor(menu.nodeId!, c.hex); onClose(); }}  /* visual hex stored in data.color; unresolveColor maps back on save */
                />
              ))}
              <button
                className="w-5 h-5 rounded-full border border-border bg-card hover:scale-110 transition-transform text-[9px]"
                title="Remove color"
                onClick={() => { setNodeColor(menu.nodeId!, undefined); onClose(); }}
              >
                x
              </button>
            </div>
          </div>
          <div className="h-px bg-border my-1" />
          <button
            className="w-full px-3 py-1.5 text-left hover:bg-destructive/10 text-destructive flex items-center gap-2"
            onClick={() => { deleteNode(menu.nodeId!); onClose(); }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      </div>
    );
  }

  if (menu.type === "edge" && menu.edgeId) {
    return (
      <div style={style} onClick={(e) => e.stopPropagation()}>
        <div className="bg-popover border border-border rounded-md shadow-md py-1 min-w-[140px] text-sm">
          <button
            className="w-full px-3 py-1.5 text-left hover:bg-destructive/10 text-destructive flex items-center gap-2"
            onClick={() => { deleteEdge(menu.edgeId!); onClose(); }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete edge
          </button>
        </div>
      </div>
    );
  }

  return null;
}

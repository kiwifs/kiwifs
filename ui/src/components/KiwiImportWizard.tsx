import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, CheckCircle, Loader2, AlertCircle, RefreshCw,
  Cloud, FolderOpen, FileText, Database, ChevronDown,
  ChevronRight, Eye, Import, Check, X, Upload, Info, SlidersHorizontal,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  api,
  type AirbyteSpecProperty,
  type AirbyteSpecResponse,
  type AirbyteStream,
  type ImportFieldMapping,
  type ImportInferFieldsResponse,
  type ImportPreviewRequest,
  type ImportPreviewResponse,
  type ImportRunRequest,
  type ImportRunResponse,
} from "../lib/api";
import { SourceIcon } from "./SourceIcon";
import {
  IMPORT_SOURCE_OPTIONS as SOURCE_OPTIONS,
  isAirbyteSourceType,
  sourceTypeLabel,
  type ImportSourceType as SourceType,
} from "../lib/importSourceLabels";

/* ─── helpers ─── */

function friendlyError(raw: string, context?: "connector" | "connection" | "import"): string {
  const lower = raw.toLowerCase();
  if (lower.includes("404") || lower.includes("not found")) {
    if (context === "connector") return "Airbyte connectors are not available on this instance. Please ensure kiwifs is updated and Docker is running.";
    return "The requested resource was not found. Your kiwifs instance may need to be updated.";
  }
  if (lower.includes("502") || lower.includes("bad gateway")) return "Could not reach the kiwifs server. It may be restarting — try again in a moment.";
  if (lower.includes("401") || lower.includes("unauthorized")) return "Authentication required. Please check your session or API key.";
  if (lower.includes("403") || lower.includes("forbidden")) return "Permission denied. You may not have access to this resource.";
  if (lower.includes("503") || lower.includes("unavailable")) return "The service is temporarily unavailable. Please try again shortly.";
  if (lower.includes("timeout") || lower.includes("timed out")) return "The request timed out. The server may be under heavy load or the connector is taking too long to respond.";
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("econnrefused")) return "Unable to connect to the server. Please check your network connection.";
  if (lower.includes("docker")) return "Docker is required for this connector but is not available. Please install and start Docker Desktop.";
  return raw.replace(/^Error:\s*/i, "").replace(/\d{3}\s*(Not Found|Bad Gateway|Unauthorized|Forbidden):\s*/i, "").trim();
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SOURCE_GROUPS = [
  { title: "Files", description: "Upload or point to files", sources: ["csv", "json", "jsonl", "yaml", "excel", "sqlite"] },
  { title: "Documents", description: "Import markdown files or Obsidian vaults", sources: ["markdown", "obsidian"] },
  { title: "Databases", description: "Connect to a running database", sources: ["postgres", "mysql", "mongodb"] },
  { title: "Cloud Services", description: "Sync from cloud platforms via Airbyte", sources: ["firestore", "firebase-rtdb", "notion", "airtable"] },
] as const;

const DB_DEFAULTS: Record<string, { port: number; protocol: string; placeholder: string }> = {
  postgres: { port: 5432, protocol: "postgres", placeholder: "postgres://user:password@localhost:5432/mydb" },
  mysql: { port: 3306, protocol: "mysql", placeholder: "user:password@tcp(localhost:3306)/mydb" },
  mongodb: { port: 27017, protocol: "mongodb", placeholder: "mongodb://user:password@localhost:27017" },
};

/** Sources that support browser file upload via the /import/upload endpoint */
const UPLOADABLE_SOURCES = new Set(["csv", "json", "jsonl", "yaml", "excel", "sqlite"]);

/** Structured sources that support the field-mapping wizard step */
const FIELD_MAPPING_SOURCES = new Set([
  "csv", "json", "jsonl", "yaml", "excel", "sqlite",
  "postgres", "mysql", "mongodb", "firestore",
]);

function supportsFieldMapping(sourceType: SourceType | null): boolean {
  return sourceType != null && FIELD_MAPPING_SOURCES.has(sourceType);
}

const FILE_ACCEPT: Record<string, string> = {
  csv: ".csv,text/csv",
  json: ".json,application/json",
  jsonl: ".jsonl,.ndjson",
  yaml: ".yaml,.yml",
  excel: ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  sqlite: ".db,.sqlite,.sqlite3",
};

/* ─── state ─── */

type WizardState = {
  step: number;
  sourceType: SourceType | null;
  airbyteSpec: AirbyteSpecResponse | null;
  airbyteConfig: Record<string, unknown>;
  airbyteStreams: AirbyteStream[];
  airbyteDockerAvailable: boolean | null;
  airbyteCloudMode: boolean;
  databaseId: string;
  baseId: string;
  tableId: string;
  apiKey: string;
  path: string;
  file: string;
  db: string;
  uploadedFile: File | null;
  dbHost: string;
  dbPort: string;
  dbName: string;
  dbUser: string;
  dbPass: string;
  dbSSL: boolean;
  useConnectionString: boolean;
  dsn: string;
  uri: string;
  database: string;
  collection: string;
  table: string;
  query: string;
  project: string;
  credentials: string;
  connectionTested: boolean;
  connectionOk: boolean;
  connectionError: string;
  browsedTables: { name: string; estimated_count?: number }[];
  browseLoading: boolean;
  selectedStreams: string[];
  selectedTable: string;
  prefix: string;
  idColumn: string;
  fieldMappings: ImportFieldMapping[];
  previews: { path: string; frontmatter: Record<string, unknown>; body_preview: string }[];
  importResult: { imported: number; skipped: number; archived?: number; errors: string[] } | null;
};

const initialState: WizardState = {
  step: 1, sourceType: null,
  airbyteSpec: null, airbyteConfig: {}, airbyteStreams: [], airbyteDockerAvailable: null, airbyteCloudMode: false,
  databaseId: "", baseId: "", tableId: "", apiKey: "",
  path: "", file: "", db: "", uploadedFile: null,
  dbHost: "localhost", dbPort: "", dbName: "", dbUser: "", dbPass: "", dbSSL: false, useConnectionString: false,
  dsn: "", uri: "", database: "", collection: "", table: "", query: "",
  project: "", credentials: "",
  connectionTested: false, connectionOk: false, connectionError: "",
  browsedTables: [], browseLoading: false,
  selectedStreams: [], selectedTable: "",
  prefix: "", idColumn: "",
  fieldMappings: [],
  previews: [], importResult: null,
};

/* ═══════════════════════════════════════════════════════════
   Drag-and-Drop File Upload Zone
   ═══════════════════════════════════════════════════════════ */

function FileDropZone({ accept, file, onSelect, onClear, label }: {
  accept: string; file: File | null; onSelect: (f: File) => void; onClear: () => void; label: string;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCount = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); dragCount.current++; setDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); dragCount.current--; if (dragCount.current <= 0) { setDragging(false); dragCount.current = 0; } };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false); dragCount.current = 0;
    const f = e.dataTransfer.files[0];
    if (f) onSelect(f);
  };
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onSelect(f);
    e.target.value = "";
  };

  if (file) {
    return (
      <div className="border border-border rounded-lg p-4 flex items-center gap-3 bg-card">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <FileText className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{file.name}</div>
          <div className="text-xs text-muted-foreground">{humanSize(file.size)}</div>
        </div>
        <button type="button" onClick={onClear} className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent/50 transition-colors" title="Remove file">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all
        ${dragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-muted-foreground/40 hover:bg-accent/30"}`}
    >
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleChange} />
      <Upload className={`h-8 w-8 mx-auto mb-3 transition-colors ${dragging ? "text-primary" : "text-muted-foreground"}`} />
      <p className="text-sm font-medium">{dragging ? "Drop file here" : "Drop your file here or click to browse"}</p>
      <p className="text-xs text-muted-foreground mt-1.5">{label}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Main wizard
   ═══════════════════════════════════════════════════════════ */

export function KiwiImportWizard({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [state, setState] = useState<WizardState>(initialState);
  const [loading, setLoading] = useState(false);
  const [specLoading, setSpecLoading] = useState(false);
  const [specError, setSpecError] = useState<string | null>(null);
  const [specRetry, setSpecRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback((partial: Partial<WizardState>) => { setState((prev) => ({ ...prev, ...partial })); setError(null); }, []);

  const isUploadable = UPLOADABLE_SOURCES.has(state.sourceType ?? "");

  // Airbyte spec fetch
  useEffect(() => {
    if (!state.sourceType || !isAirbyteSourceType(state.sourceType) || state.step !== 2) return;
    if (state.airbyteSpec || state.airbyteCloudMode) return;
    let cancelled = false;
    setSpecLoading(true); setSpecError(null);
    api.importAirbyteSpec(state.sourceType).then((spec) => {
      if (!cancelled) {
        if ((spec as any).mode === "cloud") update({ airbyteCloudMode: true, airbyteDockerAvailable: false });
        else update({ airbyteSpec: spec, airbyteDockerAvailable: true });
        setSpecLoading(false);
      }
    }).catch((err) => {
      if (!cancelled) {
        setSpecLoading(false);
        const errStr = String(err);
        if (errStr.includes("docker") || errStr.includes("Docker")) update({ airbyteDockerAvailable: false });
        else setSpecError(friendlyError(errStr, "connector"));
      }
    });
    return () => { cancelled = true; };
  }, [state.sourceType, state.step, state.airbyteSpec, state.airbyteCloudMode, specRetry, update]);

  const buildConnectionString = useCallback((): string => {
    const s = state;
    if (s.sourceType === "postgres") {
      const port = s.dbPort || "5432"; const ssl = s.dbSSL ? "?sslmode=require" : "";
      if (s.dbUser && s.dbPass) return `postgres://${s.dbUser}:${s.dbPass}@${s.dbHost}:${port}/${s.dbName}${ssl}`;
      if (s.dbUser) return `postgres://${s.dbUser}@${s.dbHost}:${port}/${s.dbName}${ssl}`;
      return `postgres://${s.dbHost}:${port}/${s.dbName}${ssl}`;
    }
    if (s.sourceType === "mysql") {
      const port = s.dbPort || "3306";
      if (s.dbUser && s.dbPass) return `${s.dbUser}:${s.dbPass}@tcp(${s.dbHost}:${port})/${s.dbName}`;
      if (s.dbUser) return `${s.dbUser}@tcp(${s.dbHost}:${port})/${s.dbName}`;
      return `tcp(${s.dbHost}:${port})/${s.dbName}`;
    }
    if (s.sourceType === "mongodb") {
      const port = s.dbPort || "27017";
      if (s.dbUser && s.dbPass) return `mongodb://${s.dbUser}:${s.dbPass}@${s.dbHost}:${port}`;
      return `mongodb://${s.dbHost}:${port}`;
    }
    return "";
  }, [state]);
  const getEffectiveDSN = useCallback((): string => state.useConnectionString ? state.dsn : buildConnectionString(), [state.useConnectionString, state.dsn, buildConnectionString]);
  const getEffectiveURI = useCallback((): string => state.useConnectionString ? state.uri : buildConnectionString(), [state.useConnectionString, state.uri, buildConnectionString]);

  const handleTestConnection = async () => {
    if (!state.sourceType) return;
    setLoading(true);
    update({ connectionTested: false, connectionOk: false, connectionError: "", browsedTables: [] });
    try {
      const params: Record<string, unknown> = { from: state.sourceType };
      if (state.sourceType === "postgres" || state.sourceType === "mysql") params.dsn = getEffectiveDSN();
      else if (state.sourceType === "mongodb") { params.uri = getEffectiveURI(); params.database = state.useConnectionString ? state.database : state.dbName; }
      else if (state.sourceType === "firestore") { params.project = state.project; if (state.credentials) params.credentials = JSON.parse(state.credentials); }
      const resp = await api.importBrowse(params as any);
      update({ connectionTested: true, connectionOk: true, connectionError: "", browsedTables: resp.tables || [] });
    } catch (err) {
      update({ connectionTested: true, connectionOk: false, connectionError: friendlyError(String(err), "connection"), browsedTables: [] });
    } finally { setLoading(false); }
  };

  const handleAirbyteCheck = async () => {
    if (!state.sourceType) return;
    setLoading(true); setError(null);
    try {
      const result = await api.importAirbyteCheck(state.sourceType, state.airbyteConfig as Record<string, unknown>);
      if (result.status === "SUCCEEDED") {
        const catalog = await api.importAirbyteDiscover(state.sourceType, state.airbyteConfig as Record<string, unknown>);
        update({ airbyteStreams: catalog.streams, step: 3 });
      } else setError(`Connection failed: ${result.message || "Unknown error"}`);
    } catch (err) { setError(friendlyError(String(err), "connection")); }
    finally { setLoading(false); }
  };

  const importPrefix = state.prefix || state.selectedTable || state.sourceType || "";
  const activeMappings = state.fieldMappings.filter((m) => !m.skip && m.target);

  const buildSourceParams = useCallback((extra?: Record<string, unknown>): Record<string, unknown> => {
    const params: Record<string, unknown> = { from: state.sourceType, prefix: importPrefix, ...extra };
    if (state.idColumn) params.id_column = state.idColumn;
    if (activeMappings.length > 0) params.field_mappings = activeMappings;
    if (isAirbyteSourceType(state.sourceType)) {
      params.via = "airbyte";
      params.airbyte_config = state.airbyteConfig;
      if (state.selectedStreams.length > 0) params.streams = state.selectedStreams;
    } else if (state.sourceType === "markdown" || state.sourceType === "obsidian") {
      params.path = state.path;
    } else if (state.sourceType === "postgres" || state.sourceType === "mysql") {
      params.dsn = getEffectiveDSN();
      params.table = state.table;
      if (state.query) params.query = state.query;
    } else if (state.sourceType === "mongodb") {
      params.uri = getEffectiveURI();
      params.database = state.useConnectionString ? state.database : state.dbName;
      params.collection = state.collection;
    } else if (state.sourceType === "firestore") {
      params.project = state.project;
      params.collection = state.collection;
      if (state.credentials) params.credentials = JSON.parse(state.credentials);
    } else if (["csv", "json", "jsonl", "yaml", "excel"].includes(state.sourceType!)) {
      params.file = state.file;
    } else if (state.sourceType === "sqlite") {
      params.db = state.db;
      params.table = state.selectedTable;
    }
    return params;
  }, [state, importPrefix, activeMappings, getEffectiveDSN, getEffectiveURI]);

  const fetchInferredFields = useCallback(async (): Promise<ImportFieldMapping[]> => {
    if (isUploadable && state.uploadedFile) {
      const resp = await api.importUpload({
        file: state.uploadedFile,
        from: state.sourceType!,
        mode: "infer-fields",
        prefix: importPrefix,
        id_column: state.idColumn || undefined,
        table: state.sourceType === "sqlite" ? state.selectedTable : undefined,
      }) as unknown as ImportInferFieldsResponse;
      return resp.fields.map((f) => ({ ...f, skip: false }));
    }
    const params = buildSourceParams();
    delete params.field_mappings;
    delete params.limit;
    const resp = await api.importInferFields(params as Omit<ImportPreviewRequest, "limit" | "field_mappings">);
    return resp.fields.map((f) => ({ ...f, skip: false }));
  }, [state, isUploadable, importPrefix, buildSourceParams]);

  const fetchPreviewRecords = useCallback(async (limit: number, applyMappings = true) => {
    const mappings = applyMappings && activeMappings.length > 0 ? activeMappings : undefined;
    if (isUploadable && state.uploadedFile) {
      const resp = await api.importUpload({
        file: state.uploadedFile,
        from: state.sourceType!,
        mode: "preview",
        prefix: importPrefix,
        id_column: state.idColumn || undefined,
        table: state.sourceType === "sqlite" ? state.selectedTable : undefined,
        field_mappings: mappings,
      }) as ImportPreviewResponse;
      return resp.records;
    }
    const params = buildSourceParams({ limit });
    if (!applyMappings) delete params.field_mappings;
    const resp = await api.importPreview(params as ImportPreviewRequest);
    return resp.records;
  }, [state, isUploadable, importPrefix, activeMappings, buildSourceParams]);

  const loadSourceFields = async () => {
    const mappings = await fetchInferredFields();
    update({ fieldMappings: mappings });
  };

  const handleReloadFields = async () => {
    setLoading(true); setError(null);
    try { await loadSourceFields(); }
    catch (err) { setError(friendlyError(String(err), "import")); }
    finally { setLoading(false); }
  };

  const handleConfigureContinue = async () => {
    if (supportsFieldMapping(state.sourceType)) {
      setLoading(true); setError(null);
      try {
        await loadSourceFields();
        update({ step: 4 });
      } catch (err) { setError(friendlyError(String(err), "import")); }
      finally { setLoading(false); }
      return;
    }
    await handlePreview();
  };

  const handlePreview = async () => {
    setLoading(true); setError(null);
    try {
      const previews = await fetchPreviewRecords(5);
      const previewStep = isAirbyteSourceType(state.sourceType) ? 5 : (supportsFieldMapping(state.sourceType) ? 5 : 4);
      update({ previews, step: previewStep });
    } catch (err) { setError(friendlyError(String(err), "import")); }
    finally { setLoading(false); }
  };

  const handleImport = async () => {
    setLoading(true); setError(null);
    try {
      let result: { imported: number; skipped: number; archived?: number; errors: string[] };
      if (isUploadable && state.uploadedFile) {
        result = (await api.importUpload({
          file: state.uploadedFile,
          from: state.sourceType!,
          mode: "import",
          prefix: importPrefix,
          id_column: state.idColumn || undefined,
          table: state.sourceType === "sqlite" ? state.selectedTable : undefined,
          field_mappings: activeMappings.length > 0 ? activeMappings : undefined,
        })) as ImportRunResponse;
      } else {
        result = await api.importRun(buildSourceParams() as ImportRunRequest);
      }
      update({ importResult: result, step: totalSteps });
    } catch (err) { setError(friendlyError(String(err), "import")); }
    finally { setLoading(false); }
  };

  const isAirbyte = isAirbyteSourceType(state.sourceType);
  const hasFieldMapping = supportsFieldMapping(state.sourceType);
  const totalSteps = isAirbyte ? 6 : (hasFieldMapping ? 6 : 5);

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-2">
        <button type="button" onClick={state.step === 1 ? onClose : () => update({ step: state.step - 1 })} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-accent/50"><ArrowLeft className="h-4 w-4" /></button>
        <div className="min-w-0 flex-1"><h1 className="text-lg font-semibold">Import data</h1></div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-accent/50"><X className="h-4 w-4" /></button>
      </div>
      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-sm px-4 py-3 rounded-lg mb-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
          <div className="space-y-1 flex-1"><p className="text-foreground font-medium">Something went wrong</p><p className="text-muted-foreground">{error}</p></div>
          <button onClick={() => setError(null)} className="text-muted-foreground hover:text-foreground p-0.5"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Step 1: Source selection */}
      {state.step === 1 && (
        <div className="max-h-[min(60dvh,30rem)] sm:max-h-[min(70dvh,36rem)] overflow-y-auto overscroll-y-contain pr-1 -mr-1 [scrollbar-gutter:stable]" role="listbox" aria-label="Choose a data source">
          <p className="text-sm text-muted-foreground mb-5">Choose a source to import data from.</p>
          {SOURCE_GROUPS.map((group) => {
            const groupOptions = group.sources.map((t) => SOURCE_OPTIONS.find((o) => o.type === t)).filter(Boolean) as typeof SOURCE_OPTIONS;
            if (groupOptions.length === 0) return null;
            return (
              <div key={group.title} className="mb-6 last:mb-1">
                <div className="flex items-center gap-2 mb-2.5">
                  {group.title === "Files" && <Upload className="h-3.5 w-3.5 text-muted-foreground" />}
                  {group.title === "Documents" && <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
                  {group.title === "Databases" && <Database className="h-3.5 w-3.5 text-muted-foreground" />}
                  {group.title === "Cloud Services" && <Cloud className="h-3.5 w-3.5 text-muted-foreground" />}
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{group.title}</h3>
                  <span className="text-[10px] text-muted-foreground/60">{group.description}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {groupOptions.map((opt) => (
                    <button key={opt.type} type="button" role="option"
                      onClick={() => update({ sourceType: opt.type, step: 2, airbyteSpec: null, airbyteConfig: {}, airbyteCloudMode: false, dbPort: DB_DEFAULTS[opt.type]?.port?.toString() || "", connectionTested: false, connectionOk: false, browsedTables: [], uploadedFile: null })}
                      className="group border border-border rounded-lg px-3 py-3 hover:bg-accent/50 hover:border-primary/30 text-left transition-all flex items-center gap-3">
                      <div className="shrink-0"><SourceIcon source={opt.type} size={24} /></div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm leading-tight">{opt.label}</div>
                        <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{opt.description}</div>
                      </div>
                      {opt.backend === "airbyte" && <span className="shrink-0 inline-flex items-center rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-medium text-sky-700 dark:text-sky-300 ring-1 ring-inset ring-sky-500/20">Airbyte</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Step 2: Connection config */}
      {state.step === 2 && state.sourceType && (
        <div className="space-y-4">
          {isAirbyteSourceType(state.sourceType) ? (
            <AirbyteConfigForm sourceType={state.sourceType} spec={state.airbyteSpec} specLoading={specLoading} specError={specError} config={state.airbyteConfig} dockerAvailable={state.airbyteDockerAvailable} cloudMode={state.airbyteCloudMode} onConfigChange={(cfg) => update({ airbyteConfig: cfg })} onConnect={handleAirbyteCheck} connecting={loading} onCancel={onClose} onRetry={() => { setSpecError(null); setSpecRetry((n) => n + 1); update({ airbyteSpec: null, airbyteCloudMode: false, airbyteDockerAvailable: null }); }} />
          ) : state.sourceType === "firestore" ? (
            <FirestoreForm state={state} update={update} onCancel={onClose} onTestConnection={handleTestConnection} onNext={() => update({ selectedTable: state.collection || "data", step: 3 })} loading={loading} />
          ) : (state.sourceType === "postgres" || state.sourceType === "mysql" || state.sourceType === "mongodb") ? (
            <NativeSourceForm sourceType={state.sourceType} state={state} update={update} onCancel={onClose} onTestConnection={handleTestConnection} onNext={() => update({ selectedTable: state.table || state.collection || state.selectedTable || "data", step: 3 })} loading={loading} />
          ) : UPLOADABLE_SOURCES.has(state.sourceType) ? (
            <UploadableSourceForm sourceType={state.sourceType} state={state} update={update} onCancel={onClose} onNext={() => {
              const name = state.uploadedFile?.name?.replace(/\.\w+$/, "") || state.file.split(/[/\\]/).pop()?.replace(/\.\w+$/, "") || "data";
              update({ selectedTable: state.sourceType === "sqlite" ? (state.selectedTable || "data") : name, step: 3 });
            }} loading={loading} />
          ) : (
            <FolderSourceForm sourceType={state.sourceType} state={state} update={update} onCancel={onClose} onNext={() => update({ selectedTable: state.path.split(/[/\\]/).filter(Boolean).pop() || "docs", step: 3 })} loading={loading} />
          )}
        </div>
      )}

      {/* Step 3 */}
      {state.step === 3 && isAirbyte && <StreamSelectionStep state={state} update={update} onNext={() => update({ selectedTable: state.selectedStreams[0] || state.airbyteStreams[0]?.name || state.sourceType || "data", step: 4 })} />}
      {state.step === 3 && !isAirbyte && (
        <ConfigureStep state={state} update={update} onBack={() => update({ step: 2 })} onContinue={handleConfigureContinue} showMappingNext={hasFieldMapping} loading={loading} />
      )}
      {/* Step 4 */}
      {state.step === 4 && isAirbyte && (
        <ConfigureStep state={state} update={update} onBack={() => update({ step: 3 })} onContinue={handlePreview} showMappingNext={false} loading={loading} />
      )}
      {state.step === 4 && !isAirbyte && hasFieldMapping && (
        <FieldMappingStep state={state} update={update} onBack={() => update({ step: 3 })} onPreview={handlePreview} onReload={handleReloadFields} loading={loading} />
      )}
      {state.step === 4 && !isAirbyte && !hasFieldMapping && (
        <PreviewStep state={state} onBack={() => update({ step: 3 })} onImport={handleImport} loading={loading} />
      )}
      {/* Step 5 */}
      {state.step === 5 && (isAirbyte || hasFieldMapping) && (
        <PreviewStep state={state} onBack={() => update({ step: 4 })} onImport={handleImport} loading={loading} />
      )}
      {state.step === 5 && !isAirbyte && !hasFieldMapping && state.importResult && (
        <ResultsStep result={state.importResult} sourceType={state.sourceType} onComplete={onComplete} />
      )}
      {/* Step 6 */}
      {state.step === 6 && state.importResult && <ResultsStep result={state.importResult} sourceType={state.sourceType} onComplete={onComplete} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Uploadable Source Form (CSV, JSON, JSONL, YAML, Excel, SQLite)
   ═══════════════════════════════════════════════════════════ */

function UploadableSourceForm({ sourceType, state, update, onCancel, onNext, loading }: {
  sourceType: SourceType; state: WizardState; update: (p: Partial<WizardState>) => void;
  onCancel: () => void; onNext: () => void; loading: boolean;
}) {
  const isSQLite = sourceType === "sqlite";
  const [showServerPath, setShowServerPath] = useState(false);
  const accept = FILE_ACCEPT[sourceType] || "";
  const formatLabel = sourceTypeLabel(sourceType);
  const canProceed = isSQLite
    ? (state.uploadedFile != null || state.db.trim().length > 0) && state.selectedTable.trim().length > 0
    : (state.uploadedFile != null || state.file.trim().length > 0);

  return (
    <>
      <div className="flex items-center gap-2.5 mb-4">
        <SourceIcon source={sourceType} size={22} />
        <div>
          <h2 className="font-medium">Import {formatLabel}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{isSQLite ? "Upload a SQLite database file or point to one on the server" : `Upload a ${formatLabel} file from your computer`}</p>
        </div>
      </div>
      <FileDropZone accept={accept} file={state.uploadedFile} onSelect={(f) => update({ uploadedFile: f, file: "" })} onClear={() => update({ uploadedFile: null })} label={`Accepts ${accept.split(",").map(s => s.trim()).filter(s => s.startsWith(".")).join(", ")} files`} />
      {!state.uploadedFile && (
        <div className="mt-3">
          <button type="button" onClick={() => setShowServerPath(!showServerPath)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            {showServerPath ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Or use a server-side file path
          </button>
          {showServerPath && (
            <div className="mt-2">
              <input type="text" value={isSQLite ? state.db : state.file} onChange={(e) => update(isSQLite ? { db: e.target.value } : { file: e.target.value })} placeholder={isSQLite ? "/path/on/server/data.sqlite" : `/path/on/server/data${accept.split(",")[0] || ""}`} className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono" />
              <p className="text-xs text-muted-foreground mt-1">Absolute path on the machine where kiwifs is running</p>
            </div>
          )}
        </div>
      )}
      {isSQLite && (
        <label className="block mt-3">
          <span className="text-sm font-medium">Table name<span className="text-destructive ml-0.5">*</span></span>
          <input type="text" value={state.selectedTable} onChange={(e) => update({ selectedTable: e.target.value })} placeholder="my_table" className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </label>
      )}
      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={onNext} disabled={loading || !canProceed}>{loading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Continue<ArrowRight className="h-3.5 w-3.5 ml-1.5" /></Button>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   Folder Source Form (Markdown, Obsidian)
   ═══════════════════════════════════════════════════════════ */

function FolderSourceForm({ sourceType, state, update, onCancel, onNext, loading }: {
  sourceType: SourceType; state: WizardState; update: (p: Partial<WizardState>) => void;
  onCancel: () => void; onNext: () => void; loading: boolean;
}) {
  const isObsidian = sourceType === "obsidian";
  return (
    <>
      <div className="flex items-center gap-2.5 mb-4">
        <SourceIcon source={sourceType} size={22} />
        <div>
          <h2 className="font-medium">{isObsidian ? "Import Obsidian vault" : "Import Markdown files"}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{isObsidian ? "Import all notes from an Obsidian vault directory" : "Import all .md files from a directory"}</p>
        </div>
      </div>
      <div className="bg-muted/50 border border-border rounded-lg px-4 py-3 flex items-start gap-3 mb-4">
        <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p>{isObsidian ? "Enter the path to your Obsidian vault on the machine where kiwifs is running. The vault root is the folder containing the .obsidian/ directory." : "Enter the path to a folder of .md files on the machine where kiwifs is running. All markdown files (including subdirectories) will be imported."}</p>
          <p>If kiwifs is running locally, this is a path on your computer. If it's on a remote server, you'll need to copy files there first.</p>
        </div>
      </div>
      <label className="block">
        <span className="text-sm font-medium">{isObsidian ? "Vault path" : "Directory path"}<span className="text-destructive ml-0.5">*</span></span>
        <div className="relative mt-1">
          <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input type="text" value={state.path} onChange={(e) => update({ path: e.target.value })} placeholder={isObsidian ? "/Users/me/Documents/My Vault" : "/Users/me/Documents/notes"} className="block w-full rounded-md border border-border bg-background pl-9 pr-3 py-2 text-sm" />
        </div>
      </label>
      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={onNext} disabled={loading || state.path.trim().length === 0}>{loading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Continue<ArrowRight className="h-3.5 w-3.5 ml-1.5" /></Button>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   Stream Selection (Airbyte step 3)
   ═══════════════════════════════════════════════════════════ */

function StreamSelectionStep({ state, update, onNext }: { state: WizardState; update: (p: Partial<WizardState>) => void; onNext: () => void }) {
  return (
    <div className="space-y-4">
      <div><h2 className="font-medium">Select streams to import</h2><p className="text-sm text-muted-foreground mt-1">Choose which collections or tables to sync.</p></div>
      {state.airbyteStreams.length === 0 ? <p className="text-muted-foreground text-sm py-4">No streams found. Check your connection.</p> : (
        <div className="border border-border rounded-lg divide-y divide-border max-h-72 overflow-auto">
          {state.airbyteStreams.map((stream) => {
            const selected = state.selectedStreams.includes(stream.name);
            return (
              <label key={stream.name} className={`flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50 cursor-pointer transition-colors ${selected ? "bg-primary/5" : ""}`}>
                <input type="checkbox" checked={selected} onChange={() => update({ selectedStreams: selected ? state.selectedStreams.filter((s) => s !== stream.name) : [...state.selectedStreams, stream.name] })} className="rounded border-border accent-primary" />
                <div className="flex-1 min-w-0"><span className="font-medium text-sm">{stream.name}</span>{stream.namespace && <span className="text-xs text-muted-foreground ml-2">{stream.namespace}</span>}</div>
                {stream.supported_sync_modes && <span className="text-[10px] text-muted-foreground">{stream.supported_sync_modes.join(", ")}</span>}
              </label>
            );
          })}
        </div>
      )}
      <div className="flex justify-between items-center pt-2">
        <span className="text-xs text-muted-foreground">{state.selectedStreams.length === 0 ? "All streams will be imported" : `${state.selectedStreams.length} selected`}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => update({ step: 2 })}>Back</Button>
          <Button size="sm" onClick={onNext}>Configure <ArrowRight className="h-3.5 w-3.5 ml-1.5" /></Button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Configure Step
   ═══════════════════════════════════════════════════════════ */

function ConfigureStep({ state, update, onBack, onContinue, showMappingNext, loading }: {
  state: WizardState; update: (p: Partial<WizardState>) => void; onBack: () => void;
  onContinue: () => void; showMappingNext: boolean; loading: boolean;
}) {
  const prefix = state.prefix || state.selectedTable;
  return (
    <div className="space-y-4">
      <div><h2 className="font-medium">Import configuration</h2><p className="text-sm text-muted-foreground mt-1">Configure how imported records are stored.</p></div>
      <label className="block">
        <span className="text-sm font-medium">Target folder</span>
        <div className="relative mt-1"><FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><input type="text" value={state.prefix || state.selectedTable} onChange={(e) => update({ prefix: e.target.value })} placeholder={state.selectedTable} className="block w-full rounded-md border border-border bg-background pl-9 pr-3 py-2 text-sm" /></div>
        <p className="text-xs text-muted-foreground mt-1.5">Records will be created as <code className="bg-muted px-1 py-0.5 rounded text-[11px]">{prefix}/&lt;id&gt;.md</code></p>
      </label>
      <label className="block">
        <span className="text-sm font-medium">ID column <span className="text-xs text-muted-foreground ml-1.5 font-normal">(optional)</span></span>
        <input type="text" value={state.idColumn} onChange={(e) => update({ idColumn: e.target.value })} placeholder="Auto-detect (primary key or document ID)" className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        <p className="text-xs text-muted-foreground mt-1.5">Used to name files and detect updates on re-import</p>
      </label>
      <div className="flex justify-end gap-2 pt-3">
        <Button variant="outline" size="sm" onClick={onBack}>Back</Button>
        <Button size="sm" onClick={onContinue} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : showMappingNext ? <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" /> : <Eye className="h-3.5 w-3.5 mr-1.5" />}
          {showMappingNext ? "Map fields" : "Preview"}
        </Button>
      </div>
    </div>
  );
}

function FieldMappingStep({ state, update, onBack, onPreview, onReload, loading }: {
  state: WizardState; update: (p: Partial<WizardState>) => void; onBack: () => void;
  onPreview: () => void; onReload: () => Promise<void>; loading: boolean;
}) {
  const setMapping = (index: number, patch: Partial<ImportFieldMapping>) => {
    const next = state.fieldMappings.map((m, i) => (i === index ? { ...m, ...patch } : m));
    update({ fieldMappings: next });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Field mapping</h2>
          <p className="text-sm text-muted-foreground mt-1">Map source fields to frontmatter keys. Types are inferred from up to 100 sample rows — adjust or skip fields as needed.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void onReload()} disabled={loading}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Reload
        </Button>
      </div>
      {state.fieldMappings.length === 0 ? (
        <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
          No fields detected. Check your source configuration and try reloading.
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 px-3 py-2 bg-muted/40 text-xs font-medium text-muted-foreground">
            <span>Source field</span>
            <span>Frontmatter key</span>
            <span>Type</span>
            <span className="text-center w-14">Skip</span>
          </div>
          <div className="max-h-64 overflow-auto divide-y divide-border">
            {state.fieldMappings.map((m, i) => (
              <div key={m.source} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 px-3 py-2 items-center text-sm">
                <span className="font-mono text-xs truncate" title={m.source}>{m.source}</span>
                <input
                  type="text"
                  value={m.target}
                  disabled={m.skip}
                  onChange={(e) => setMapping(i, { target: e.target.value })}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs font-mono disabled:opacity-50"
                />
                <select
                  value={m.type || "string"}
                  disabled={m.skip}
                  onChange={(e) => setMapping(i, { type: e.target.value as ImportFieldMapping["type"] })}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-50"
                >
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="date">date</option>
                  <option value="boolean">boolean</option>
                </select>
                <label className="flex justify-center w-14">
                  <input type="checkbox" checked={!!m.skip} onChange={(e) => setMapping(i, { skip: e.target.checked })} className="rounded" />
                </label>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onBack}>Back</Button>
        <Button size="sm" onClick={onPreview} disabled={loading || state.fieldMappings.every((m) => m.skip)}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Eye className="h-3.5 w-3.5 mr-1.5" />}
          Preview
        </Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Preview Step
   ═══════════════════════════════════════════════════════════ */

function PreviewStep({ state, onBack, onImport, loading }: { state: WizardState; onBack: () => void; onImport: () => void; loading: boolean }) {
  return (
    <div className="space-y-4">
      <div><h2 className="font-medium">Preview</h2><p className="text-sm text-muted-foreground mt-1">{state.previews.length} sample record{state.previews.length !== 1 ? "s" : ""} as they will appear in your knowledge base.</p></div>
      <div className="space-y-2 max-h-72 overflow-auto rounded-lg">
        {state.previews.map((rec, i) => (
          <div key={i} className="border border-border rounded-md p-3 bg-card">
            <div className="flex items-center gap-2 mb-1.5"><FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" /><span className="text-xs font-mono text-muted-foreground truncate">{rec.path}</span></div>
            <div className="text-sm whitespace-pre-wrap text-foreground/80 leading-relaxed">{rec.body_preview}</div>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onBack}>Back</Button>
        <Button size="sm" onClick={onImport} disabled={loading}>{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Import className="h-3.5 w-3.5 mr-1.5" />}Import</Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Results Step
   ═══════════════════════════════════════════════════════════ */

function ResultsStep({ result, sourceType, onComplete }: { result: { imported: number; skipped: number; archived?: number; errors: string[] }; sourceType: string | null; onComplete: () => void }) {
  const errors = result.errors ?? [];
  const hasErrors = errors.length > 0;
  const syncable = sourceType != null && ["firebase-rtdb", "firestore", "postgres", "mysql", "mongodb", "notion", "airtable"].includes(sourceType);
  return (
    <div className="text-center py-10">
      <div className={`h-14 w-14 mx-auto mb-5 rounded-full flex items-center justify-center ${hasErrors ? "bg-amber-500/10" : "bg-green-500/10"}`}>
        {hasErrors ? <AlertCircle className="h-7 w-7 text-amber-500" /> : <CheckCircle className="h-7 w-7 text-green-500" />}
      </div>
      <h2 className="text-lg font-semibold mb-1">{hasErrors ? "Import completed with errors" : "Import complete"}</h2>
      <div className="text-sm text-muted-foreground space-y-0.5 mb-4">
        <div><strong>{result.imported}</strong> documents imported</div>
        {result.skipped > 0 && <div><strong>{result.skipped}</strong> unchanged (skipped)</div>}
        {(result.archived ?? 0) > 0 && <div><strong>{result.archived}</strong> removed upstream (archived)</div>}
        {hasErrors && <div className="text-destructive"><strong>{errors.length}</strong> error{errors.length !== 1 ? "s" : ""}</div>}
      </div>
      {syncable && !hasErrors && (
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-full px-3 py-1.5 mb-4">
          <RefreshCw className="h-3 w-3" />
          <span>Auto-sync enabled — updates every hour</span>
        </div>
      )}
      {hasErrors && (
        <div className="text-left mx-auto max-w-md mb-6">
          <details className="border border-border rounded-lg">
            <summary className="px-4 py-2 text-sm cursor-pointer text-muted-foreground hover:text-foreground">View errors</summary>
            <div className="px-4 py-2 text-xs text-destructive space-y-1 max-h-32 overflow-auto">{errors.map((e, i) => <div key={i}>{e}</div>)}</div>
          </details>
        </div>
      )}
      <Button onClick={onComplete}>Done</Button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Airbyte Config Form
   ═══════════════════════════════════════════════════════════ */

function AirbyteConfigForm({ sourceType, spec, specLoading, specError, config, dockerAvailable, cloudMode, onConfigChange, onConnect, connecting, onCancel, onRetry }: {
  sourceType: SourceType; spec: AirbyteSpecResponse | null; specLoading: boolean; specError: string | null; config: Record<string, unknown>; dockerAvailable: boolean | null; cloudMode: boolean;
  onConfigChange: (cfg: Record<string, unknown>) => void; onConnect: () => void; connecting: boolean; onCancel: () => void; onRetry: () => void;
}) {
  if (cloudMode) return (<div className="text-center py-8 space-y-3"><Cloud className="h-10 w-10 mx-auto text-blue-500" /><h2 className="font-medium">Airbyte Cloud connected</h2><p className="text-sm text-muted-foreground max-w-md mx-auto">Your <strong>{sourceTypeLabel(sourceType)}</strong> connector will be managed through Airbyte Cloud.</p><div className="pt-2 flex gap-2 justify-center"><Button variant="outline" size="sm" onClick={onCancel}>Go back</Button><Button size="sm" onClick={onConnect}>Configure connection</Button></div></div>);
  if (dockerAvailable === false) return (<div className="text-center py-8 space-y-3"><AlertCircle className="h-10 w-10 mx-auto text-amber-500" /><h2 className="font-medium">Docker or Airbyte API key required</h2><p className="text-sm text-muted-foreground max-w-md mx-auto">The <strong>{sourceTypeLabel(sourceType)}</strong> connector requires either Docker or an Airbyte Cloud API key.</p><p className="text-xs text-muted-foreground max-w-sm mx-auto">Set <code className="bg-muted px-1.5 py-0.5 rounded">AIRBYTE_API_KEY</code> or install Docker Desktop.</p><div className="pt-2"><Button variant="outline" size="sm" onClick={onCancel}>Go back</Button></div></div>);
  if (specError) return (<div className="text-center py-8 space-y-3"><AlertCircle className="h-10 w-10 mx-auto text-muted-foreground" /><h2 className="font-medium">Connector unavailable</h2><p className="text-sm text-muted-foreground max-w-md mx-auto">{specError}</p><div className="flex items-center justify-center gap-2 pt-2"><Button variant="outline" size="sm" onClick={onCancel}>Go back</Button><Button variant="outline" size="sm" onClick={onRetry}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry</Button></div></div>);
  if (specLoading || !spec) return (<div className="flex flex-col items-center justify-center py-12 gap-3"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /><p className="text-sm text-muted-foreground">Loading {sourceTypeLabel(sourceType)} connector...</p></div>);

  const schema = spec.connectionSpecification;
  const properties = schema.properties || {};
  const required = new Set(schema.required || []);
  const sortedKeys = Object.entries(properties).sort(([, a], [, b]) => (a.order ?? 999) - (b.order ?? 999)).map(([k]) => k);
  const setField = (key: string, value: unknown) => onConfigChange({ ...config, [key]: value });

  return (
    <>
      <div className="flex items-center gap-2.5 mb-1"><SourceIcon source={sourceType} size={22} /><h2 className="font-medium">Connect to {sourceTypeLabel(sourceType)}</h2></div>
      <p className="text-xs text-muted-foreground mb-4">Credentials are sent directly to the connector, never stored.</p>
      <div className="space-y-4">{sortedKeys.map((key) => { const prop = properties[key]; if (prop.const !== undefined) return null; return <SpecField key={key} fieldKey={key} prop={prop} value={config[key]} isRequired={required.has(key)} onChange={(v) => setField(key, v)} />; })}</div>
      <div className="flex justify-end gap-2 pt-5">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={onConnect} disabled={connecting}>{connecting ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Checking...</> : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Test &amp; Discover</>}</Button>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   Spec Field (Airbyte JSON Schema)
   ═══════════════════════════════════════════════════════════ */

function SpecField({ fieldKey, prop, value, isRequired, onChange }: { fieldKey: string; prop: AirbyteSpecProperty; value: unknown; isRequired: boolean; onChange: (v: unknown) => void }) {
  const label = prop.title || fieldKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const isSecret = prop.airbyte_secret === true;
  if (prop.oneOf && prop.oneOf.length > 0) return <OneOfField fieldKey={fieldKey} prop={prop} value={value as Record<string, unknown> | undefined} isRequired={isRequired} onChange={onChange} />;
  if (prop.enum && prop.enum.length > 0) return (<label className="block"><span className="text-sm font-medium">{label}{isRequired && <span className="text-destructive ml-0.5">*</span>}</span><select value={(value as string) ?? prop.default ?? ""} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"><option value="">Select...</option>{prop.enum.map((opt) => <option key={opt} value={opt}>{opt}</option>)}</select>{prop.description && <p className="text-xs text-muted-foreground mt-1">{prop.description}</p>}</label>);
  if (prop.type === "boolean") return (<label className="flex items-center gap-2"><input type="checkbox" checked={value as boolean ?? prop.default ?? false} onChange={(e) => onChange(e.target.checked)} className="rounded border-border accent-primary" /><span className="text-sm font-medium">{label}</span>{prop.description && <span className="text-xs text-muted-foreground">— {prop.description}</span>}</label>);
  if (prop.type === "integer" || prop.type === "number") return (<label className="block"><span className="text-sm font-medium">{label}{isRequired && <span className="text-destructive ml-0.5">*</span>}</span><input type="number" value={(value as number) ?? prop.default ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />{prop.description && <p className="text-xs text-muted-foreground mt-1">{prop.description}</p>}</label>);
  if (prop.type === "object" && prop.properties) return (<label className="block"><span className="text-sm font-medium">{label}{isRequired && <span className="text-destructive ml-0.5">*</span>}</span><textarea value={typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2)} onChange={(e) => { try { onChange(JSON.parse(e.target.value)); } catch { /* typing */ } }} placeholder="{}" rows={4} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono" />{prop.description && <p className="text-xs text-muted-foreground mt-1">{prop.description}</p>}</label>);
  return (<label className="block"><span className="text-sm font-medium">{label}{isRequired && <span className="text-destructive ml-0.5">*</span>}</span><input type={isSecret ? "password" : "text"} value={value != null ? String(value) : ""} onChange={(e) => onChange(e.target.value || undefined)} placeholder={prop.default != null ? String(prop.default) : undefined} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono" />{prop.description && <p className="text-xs text-muted-foreground mt-1">{prop.description}</p>}</label>);
}

function OneOfField({ fieldKey, prop, value, isRequired, onChange }: { fieldKey: string; prop: AirbyteSpecProperty; value: Record<string, unknown> | undefined; isRequired: boolean; onChange: (v: unknown) => void }) {
  const label = prop.title || fieldKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const options = prop.oneOf || [];
  const selectedIdx = options.findIndex((opt) => opt.properties && Object.entries(opt.properties).some(([k, v]) => v.const !== undefined && value?.[k] === v.const));
  const activeIdx = selectedIdx >= 0 ? selectedIdx : 0;
  const activeOption = options[activeIdx];
  const selectOption = (idx: number) => { const opt = options[idx]; if (!opt?.properties) return; const base: Record<string, unknown> = {}; for (const [k, v] of Object.entries(opt.properties)) { if (v.const !== undefined) base[k] = v.const; else if (v.default !== undefined) base[k] = v.default; } onChange(base); };
  return (
    <div className="space-y-3 border border-border rounded-lg p-4">
      <label className="block"><span className="text-sm font-medium">{label}{isRequired && <span className="text-destructive ml-0.5">*</span>}</span><select value={activeIdx} onChange={(e) => selectOption(Number(e.target.value))} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm">{options.map((opt, i) => <option key={i} value={i}>{opt.title || `Option ${i + 1}`}</option>)}</select></label>
      {activeOption?.properties && (<div className="space-y-3 pl-3 border-l-2 border-border">{Object.entries(activeOption.properties).filter(([, v]) => v.const === undefined).map(([k, v]) => (<SpecField key={k} fieldKey={k} prop={v} value={(value as Record<string, unknown>)?.[k]} isRequired={activeOption.required?.includes(k) ?? false} onChange={(newVal) => onChange({ ...(value || {}), [k]: newVal })} />))}</div>)}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Native Source Form (PostgreSQL, MySQL, MongoDB)
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   Firestore Form (Project ID + Service Account JSON + Collection)
   ═══════════════════════════════════════════════════════════ */

function FirestoreForm({ state, update, onCancel, onTestConnection, onNext, loading }: {
  state: WizardState; update: (p: Partial<WizardState>) => void;
  onCancel: () => void; onTestConnection: () => void; onNext: () => void; loading: boolean;
}) {
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      update({ credentials: text, connectionTested: false, connectionOk: false });
      try {
        const parsed = JSON.parse(text);
        if (parsed.project_id && !state.project) update({ project: parsed.project_id });
      } catch { /* ignore parse errors */ }
    };
    reader.readAsText(file);
  };

  const canTest = state.project.trim().length > 0 && state.credentials.trim().length > 0;
  const canProceed = state.connectionOk && state.collection.trim().length > 0;

  return (
    <>
      <div className="flex items-center gap-2.5 mb-4">
        <SourceIcon source="firestore" size={22} />
        <div><h2 className="font-medium">Connect to Firestore</h2><p className="text-xs text-muted-foreground mt-0.5">Credentials are used for this session only and are not stored on the server.</p></div>
      </div>
      <div className="space-y-3">
        <label className="block">
          <span className="text-sm font-medium">Project ID<span className="text-destructive ml-0.5">*</span></span>
          <input type="text" value={state.project} onChange={(e) => update({ project: e.target.value, connectionTested: false })} placeholder="my-firebase-project" className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Service Account JSON<span className="text-destructive ml-0.5">*</span></span>
          <input type="file" accept=".json" onChange={handleFileUpload} className="mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground file:cursor-pointer hover:file:bg-primary/90" />
          {state.credentials && <p className="text-xs text-green-600 dark:text-green-400 mt-1.5 flex items-center gap-1"><Check className="h-3.5 w-3.5" />Credentials loaded</p>}
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" variant={state.connectionOk ? "outline" : "default"} onClick={onTestConnection} disabled={loading || !canTest}>
          {loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Testing...</> : state.connectionOk ? <><Check className="h-3.5 w-3.5 mr-1.5 text-green-500" /> Connected</> : <><Database className="h-3.5 w-3.5 mr-1.5" /> Test connection</>}
        </Button>
        {state.connectionTested && state.connectionOk && <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" />{state.browsedTables.length > 0 ? `${state.browsedTables.length} collection${state.browsedTables.length !== 1 ? "s" : ""} found` : "Connected successfully"}</span>}
        {state.connectionTested && !state.connectionOk && <span className="text-xs text-destructive flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5 shrink-0" /><span className="line-clamp-2">{state.connectionError}</span></span>}
      </div>
      {state.connectionOk && (
        <div className="mt-4 pt-4 border-t border-border space-y-3">
          <label className="block">
            <span className="text-sm font-medium">Collection<span className="text-destructive ml-0.5">*</span></span>
            {state.browsedTables.length > 0 ? (
              <select value={state.collection} onChange={(e) => update({ collection: e.target.value })} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
                <option value="">Select a collection...</option>
                {state.browsedTables.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            ) : (
              <input type="text" value={state.collection} onChange={(e) => update({ collection: e.target.value })} placeholder="users" className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            )}
          </label>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={onNext} disabled={loading || !canProceed}>{loading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Continue <ArrowRight className="h-3.5 w-3.5 ml-1.5" /></Button>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   Native Source Form (PostgreSQL, MySQL, MongoDB)
   ═══════════════════════════════════════════════════════════ */

function NativeSourceForm({ sourceType, state, update, onCancel, onTestConnection, onNext, loading }: {
  sourceType: SourceType; state: WizardState; update: (p: Partial<WizardState>) => void;
  onCancel: () => void; onTestConnection: () => void; onNext: () => void; loading: boolean;
}) {
  const defaults = DB_DEFAULTS[sourceType] || { port: 5432, protocol: "postgres", placeholder: "" };
  const isMongo = sourceType === "mongodb";
  const [showAdvanced, setShowAdvanced] = useState(false);
  const hasRequiredFields = isMongo
    ? state.useConnectionString ? state.uri.trim().length > 0 && state.database.trim().length > 0 && state.collection.trim().length > 0 : state.dbHost.trim().length > 0 && state.dbName.trim().length > 0 && state.collection.trim().length > 0
    : state.useConnectionString ? state.dsn.trim().length > 0 && (state.table.trim().length > 0 || state.query.trim().length > 0) : state.dbHost.trim().length > 0 && state.dbName.trim().length > 0 && (state.table.trim().length > 0 || state.query.trim().length > 0);
  const canProceed = state.connectionOk && hasRequiredFields;

  return (
    <>
      <div className="flex items-center gap-2.5 mb-4">
        <SourceIcon source={sourceType} size={22} />
        <div><h2 className="font-medium">Connect to {sourceTypeLabel(sourceType)}</h2><p className="text-xs text-muted-foreground mt-0.5">Credentials are used for this session only and are not stored.</p></div>
      </div>
      <div className="flex items-center gap-2 mb-4">
        <button type="button" onClick={() => update({ useConnectionString: false, connectionTested: false, connectionOk: false, browsedTables: [] })} className={`text-xs px-3 py-1.5 rounded-md transition-colors ${!state.useConnectionString ? "bg-primary text-primary-foreground font-medium" : "bg-muted text-muted-foreground hover:text-foreground"}`}>Connection fields</button>
        <button type="button" onClick={() => update({ useConnectionString: true, connectionTested: false, connectionOk: false, browsedTables: [] })} className={`text-xs px-3 py-1.5 rounded-md transition-colors ${state.useConnectionString ? "bg-primary text-primary-foreground font-medium" : "bg-muted text-muted-foreground hover:text-foreground"}`}>Connection string</button>
      </div>
      {!state.useConnectionString ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <label className="block col-span-2"><span className="text-sm font-medium">Host<span className="text-destructive ml-0.5">*</span></span><input type="text" value={state.dbHost} onChange={(e) => update({ dbHost: e.target.value, connectionTested: false })} placeholder="localhost" className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono" /></label>
            <label className="block"><span className="text-sm font-medium">Port</span><input type="text" value={state.dbPort} onChange={(e) => update({ dbPort: e.target.value, connectionTested: false })} placeholder={String(defaults.port)} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono" /></label>
          </div>
          <label className="block"><span className="text-sm font-medium">Database<span className="text-destructive ml-0.5">*</span></span><input type="text" value={state.dbName} onChange={(e) => update({ dbName: e.target.value, connectionTested: false })} placeholder="mydb" className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-sm font-medium">Username</span><input type="text" value={state.dbUser} onChange={(e) => update({ dbUser: e.target.value, connectionTested: false })} placeholder={isMongo ? "optional" : sourceType === "postgres" ? "postgres" : "root"} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono" /></label>
            <label className="block"><span className="text-sm font-medium">Password</span><input type="password" value={state.dbPass} onChange={(e) => update({ dbPass: e.target.value, connectionTested: false })} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono" /></label>
          </div>
          {sourceType === "postgres" && <label className="flex items-center gap-2"><input type="checkbox" checked={state.dbSSL} onChange={(e) => update({ dbSSL: e.target.checked, connectionTested: false })} className="rounded border-border accent-primary" /><span className="text-sm">Require SSL</span></label>}
        </div>
      ) : (
        <div className="space-y-3">
          {isMongo ? (<><label className="block"><span className="text-sm font-medium">Connection URI<span className="text-destructive ml-0.5">*</span></span><input type="text" value={state.uri} onChange={(e) => update({ uri: e.target.value, connectionTested: false })} placeholder={defaults.placeholder} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono" /></label><label className="block"><span className="text-sm font-medium">Database<span className="text-destructive ml-0.5">*</span></span><input type="text" value={state.database} onChange={(e) => update({ database: e.target.value, connectionTested: false })} placeholder="mydb" className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm" /></label></>) : (
            <label className="block"><span className="text-sm font-medium">Connection string (DSN)<span className="text-destructive ml-0.5">*</span></span><input type="text" value={state.dsn} onChange={(e) => update({ dsn: e.target.value, connectionTested: false })} placeholder={defaults.placeholder} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono" /><p className="text-xs text-muted-foreground mt-1">{sourceType === "postgres" ? "PostgreSQL connection URI" : "MySQL DSN string"}</p></label>
          )}
        </div>
      )}
      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" variant={state.connectionOk ? "outline" : "default"} onClick={onTestConnection} disabled={loading}>
          {loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Testing...</> : state.connectionOk ? <><Check className="h-3.5 w-3.5 mr-1.5 text-green-500" /> Connected</> : <><Database className="h-3.5 w-3.5 mr-1.5" /> Test connection</>}
        </Button>
        {state.connectionTested && state.connectionOk && <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" />{state.browsedTables.length > 0 ? `${state.browsedTables.length} table${state.browsedTables.length !== 1 ? "s" : ""} found` : "Connected successfully"}</span>}
        {state.connectionTested && !state.connectionOk && <span className="text-xs text-destructive flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5 shrink-0" /><span className="line-clamp-2">{state.connectionError}</span></span>}
      </div>
      {state.connectionOk && (
        <div className="mt-4 pt-4 border-t border-border space-y-3">
          {isMongo ? (
            <label className="block"><span className="text-sm font-medium">Collection<span className="text-destructive ml-0.5">*</span></span>{state.browsedTables.length > 0 ? <select value={state.collection} onChange={(e) => update({ collection: e.target.value })} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"><option value="">Select a collection...</option>{state.browsedTables.map((t) => <option key={t.name} value={t.name}>{t.name}{t.estimated_count != null ? ` (~${t.estimated_count} docs)` : ""}</option>)}</select> : <input type="text" value={state.collection} onChange={(e) => update({ collection: e.target.value })} placeholder="users" className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />}</label>
          ) : (<>
            <label className="block"><span className="text-sm font-medium">Table<span className="text-destructive ml-0.5">*</span></span>{state.browsedTables.length > 0 ? <select value={state.table} onChange={(e) => update({ table: e.target.value })} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"><option value="">Select a table...</option>{state.browsedTables.map((t) => <option key={t.name} value={t.name}>{t.name}{t.estimated_count != null ? ` (~${t.estimated_count} rows)` : ""}</option>)}</select> : <input type="text" value={state.table} onChange={(e) => update({ table: e.target.value })} placeholder="users" className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />}</label>
            <div>
              <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">{showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}Custom SQL query</button>
              {showAdvanced && <textarea value={state.query} onChange={(e) => update({ query: e.target.value })} placeholder="SELECT * FROM users WHERE active = true" rows={3} className="mt-2 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono" />}
            </div>
          </>)}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={onNext} disabled={loading || !canProceed}>{loading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Continue <ArrowRight className="h-3.5 w-3.5 ml-1.5" /></Button>
      </div>
    </>
  );
}

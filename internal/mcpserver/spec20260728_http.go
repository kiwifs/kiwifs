package mcpserver

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

const (
	headerMCPMethod  = "Mcp-Method"
	headerMCPName    = "Mcp-Name"
	headerMCPProto   = "MCP-Protocol-Version"
	headerSessionID  = "Mcp-Session-Id"
)

type spec20260728HTTPHandler struct {
	srv *server.MCPServer
	next http.Handler
}

func newSpec20260728HTTPHandler(s *server.MCPServer, next http.Handler) http.Handler {
	return &spec20260728HTTPHandler{srv: s, next: next}
}

func (h *spec20260728HTTPHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || r.URL.Path != "/mcp" {
		h.next.ServeHTTP(w, r)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))

	var envelope struct {
		ID     any             `json:"id"`
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil || envelope.Method == "" {
		h.next.ServeHTTP(w, r)
		return
	}

	name := routingName(envelope.Method, envelope.Params)
	if err := validateRoutingHeaders(r.Header.Get(headerMCPMethod), r.Header.Get(headerMCPName), envelope.Method, name); err != nil {
		writeJSONRPCError(w, envelope.ID, mcp.INVALID_REQUEST, err.Error())
		return
	}

	if envelope.Method == "server/discover" {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set(headerMCPMethod, "server/discover")
		w.Header().Set(headerMCPProto, ProtocolVersion20260728)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(discoverResponse(envelope.ID, h.srv))
		return
	}

	rec := &spec20260728ResponseRecorder{ResponseWriter: w, method: envelope.Method, name: name}
	h.next.ServeHTTP(rec, r)

	if rec.status == 0 {
		rec.status = http.StatusOK
	}
	if rec.body.Len() == 0 {
		return
	}

	patched := patchSpec20260728Response(rec.body.Bytes(), envelope.Method)
	for k, v := range rec.header {
		w.Header()[k] = v
	}
	w.Header().Set(headerMCPMethod, envelope.Method)
	if name != "" {
		w.Header().Set(headerMCPName, name)
	}
	if proto := r.Header.Get(headerMCPProto); proto != "" {
		w.Header().Set(headerMCPProto, proto)
	} else if strings.HasPrefix(envelope.Method, "server/") || envelope.Method == "initialize" {
		w.Header().Set(headerMCPProto, mcp.LATEST_PROTOCOL_VERSION)
	}
	w.Header().Del(headerSessionID)
	w.WriteHeader(rec.status)
	_, _ = w.Write(patched)
}

type spec20260728ResponseRecorder struct {
	http.ResponseWriter
	header http.Header
	body   bytes.Buffer
	status int
	method string
	name   string
}

func (r *spec20260728ResponseRecorder) Header() http.Header {
	if r.header == nil {
		r.header = make(http.Header)
	}
	return r.header
}

func (r *spec20260728ResponseRecorder) WriteHeader(statusCode int) {
	r.status = statusCode
}

func (r *spec20260728ResponseRecorder) Write(b []byte) (int, error) {
	return r.body.Write(b)
}

func writeJSONRPCError(w http.ResponseWriter, id any, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"jsonrpc": mcp.JSONRPC_VERSION,
		"id":      id,
		"error": map[string]any{
			"code":    code,
			"message": message,
		},
	})
}

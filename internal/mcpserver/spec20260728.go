package mcpserver

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// ProtocolVersion20260728 is the MCP 2026-07-28 release candidate spec.
const ProtocolVersion20260728 = "2026-07-28"

const (
	jsonSchema202012 = "https://json-schema.org/draft/2020-12/schema"

	defaultListTTLMs        = 300_000   // 5 minutes
	defaultDiscoverTTLMs    = 3_600_000 // 1 hour
	defaultPublicCacheScope = "public"
)

var errRoutingHeaderMismatch = errors.New("Mcp-Method/Mcp-Name headers do not match JSON-RPC body")

var cacheableMethods = map[string]struct{}{
	"server/discover":          {},
	"tools/list":               {},
	"resources/list":           {},
	"resources/templates/list": {},
}

var routingNameFields = map[string]string{
	"tools/call":  "name",
	"prompts/get": "name",
}

func spec20260728Hooks() *server.Hooks {
	hooks := &server.Hooks{}
	hooks.AddAfterListTools(func(_ context.Context, _ any, _ *mcp.ListToolsRequest, result *mcp.ListToolsResult) {
		if result == nil {
			return
		}
		for i := range result.Tools {
			upgradeToolInputSchema(&result.Tools[i])
		}
	})
	return hooks
}

func discoverCapabilities(s *server.MCPServer) map[string]any {
	caps := map[string]any{}
	if len(s.ListTools()) > 0 {
		caps["tools"] = map[string]any{}
	}
	// KiwiFS always registers static resources in registerResources.
	caps["resources"] = map[string]any{}
	return caps
}

func buildDiscoverResult(s *server.MCPServer) map[string]any {
	return map[string]any{
		"resultType":        "complete",
		"supportedVersions": []string{ProtocolVersion20260728, mcp.LATEST_PROTOCOL_VERSION},
		"capabilities":      discoverCapabilities(s),
		"serverInfo": map[string]any{
			"name":    "kiwifs",
			"version": "1.0.0",
		},
		"ttlMs":      defaultDiscoverTTLMs,
		"cacheScope": defaultPublicCacheScope,
	}
}

func discoverResponse(id any, s *server.MCPServer) []byte {
	resp := map[string]any{
		"jsonrpc": mcp.JSONRPC_VERSION,
		"id":      id,
		"result":  buildDiscoverResult(s),
	}
	b, _ := json.Marshal(resp)
	return b
}

func routingName(method string, params json.RawMessage) string {
	field, ok := routingNameFields[method]
	if !ok {
		return ""
	}
	var args map[string]any
	if err := json.Unmarshal(params, &args); err != nil || args == nil {
		return ""
	}
	name, _ := args[field].(string)
	return name
}

func validateRoutingHeaders(headerMethod, headerName, bodyMethod, bodyName string) error {
	if headerMethod == "" {
		return nil
	}
	if headerMethod != bodyMethod {
		return errRoutingHeaderMismatch
	}
	if bodyName != "" && headerName != "" && headerName != bodyName {
		return errRoutingHeaderMismatch
	}
	return nil
}

func patchSpec20260728Response(body []byte, method string) []byte {
	if _, ok := cacheableMethods[method]; !ok {
		return body
	}

	var msg map[string]any
	if err := json.Unmarshal(body, &msg); err != nil {
		return body
	}
	result, ok := msg["result"].(map[string]any)
	if !ok || result == nil {
		return body
	}

	ttl := defaultListTTLMs
	if method == "server/discover" {
		ttl = defaultDiscoverTTLMs
	}
	if _, exists := result["ttlMs"]; !exists {
		result["ttlMs"] = ttl
	}
	if _, exists := result["cacheScope"]; !exists {
		result["cacheScope"] = defaultPublicCacheScope
	}

	if method == "tools/list" {
		patchToolSchemaMaps(result)
	}

	out, err := json.Marshal(msg)
	if err != nil {
		return body
	}
	return out
}

func patchToolSchemaMaps(result map[string]any) {
	tools, ok := result["tools"].([]any)
	if !ok {
		return
	}
	for _, raw := range tools {
		tool, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		schema, ok := tool["inputSchema"].(map[string]any)
		if !ok || schema == nil {
			continue
		}
		if _, has := schema["$schema"]; !has {
			schema["$schema"] = jsonSchema202012
		}
	}
}

func upgradeToolInputSchema(tool *mcp.Tool) {
	if tool == nil {
		return
	}
	if len(tool.RawInputSchema) > 0 {
		var schema map[string]any
		if err := json.Unmarshal(tool.RawInputSchema, &schema); err != nil {
			return
		}
		if _, has := schema["$schema"]; !has {
			schema["$schema"] = jsonSchema202012
			if b, err := json.Marshal(schema); err == nil {
				tool.RawInputSchema = b
			}
		}
		return
	}
	if tool.InputSchema.Type == "" {
		tool.InputSchema.Type = "object"
	}
}

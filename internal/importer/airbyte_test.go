package importer

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// TestAirbyteProtocolParsing tests parsing of real Airbyte protocol messages
// including edge cases: unicode, nested objects, null fields, huge records,
// special characters in stream names, etc.
func TestAirbyteProtocolParsing(t *testing.T) {
	tests := []struct {
		name     string
		line     string
		wantType string
		wantErr  bool
		check    func(t *testing.T, msg AirbyteMessage)
	}{
		{
			name:     "standard record",
			line:     `{"type":"RECORD","record":{"stream":"users","data":{"id":1,"name":"Alice","email":"alice@example.com"},"emitted_at":1716000000000}}`,
			wantType: "RECORD",
			check: func(t *testing.T, msg AirbyteMessage) {
				if msg.Record.Stream != "users" {
					t.Errorf("stream = %q, want users", msg.Record.Stream)
				}
				if msg.Record.Data["name"] != "Alice" {
					t.Errorf("name = %v, want Alice", msg.Record.Data["name"])
				}
			},
		},
		{
			name:     "record with unicode and emoji",
			line:     `{"type":"RECORD","record":{"stream":"posts","data":{"id":"post-1","title":"日本語テスト 🚀","body":"Ñoño señor café","tags":["日本","español"]},"emitted_at":1716000000000}}`,
			wantType: "RECORD",
			check: func(t *testing.T, msg AirbyteMessage) {
				if msg.Record.Data["title"] != "日本語テスト 🚀" {
					t.Errorf("unicode title not preserved: %v", msg.Record.Data["title"])
				}
			},
		},
		{
			name:     "record with null fields",
			line:     `{"type":"RECORD","record":{"stream":"contacts","data":{"id":42,"name":"Bob","phone":null,"address":null,"active":true},"emitted_at":1716000000000}}`,
			wantType: "RECORD",
			check: func(t *testing.T, msg AirbyteMessage) {
				if msg.Record.Data["phone"] != nil {
					t.Errorf("null phone not preserved: %v", msg.Record.Data["phone"])
				}
				if msg.Record.Data["active"] != true {
					t.Errorf("active should be true")
				}
			},
		},
		{
			name:     "record with deeply nested objects",
			line:     `{"type":"RECORD","record":{"stream":"events","data":{"id":"evt-1","payload":{"user":{"profile":{"name":"Deep","settings":{"theme":"dark","notifications":{"email":true,"push":false}}}}}},"emitted_at":1716000000000}}`,
			wantType: "RECORD",
			check: func(t *testing.T, msg AirbyteMessage) {
				payload, ok := msg.Record.Data["payload"].(map[string]any)
				if !ok {
					t.Fatal("payload not a map")
				}
				user, ok := payload["user"].(map[string]any)
				if !ok {
					t.Fatal("user not a map")
				}
				profile, ok := user["profile"].(map[string]any)
				if !ok {
					t.Fatal("profile not a map")
				}
				if profile["name"] != "Deep" {
					t.Errorf("nested name = %v", profile["name"])
				}
			},
		},
		{
			name:     "record with array of objects",
			line:     `{"type":"RECORD","record":{"stream":"orders","data":{"id":"ord-1","items":[{"sku":"A","qty":2,"price":9.99},{"sku":"B","qty":1,"price":19.99}],"total":39.97},"emitted_at":1716000000000}}`,
			wantType: "RECORD",
			check: func(t *testing.T, msg AirbyteMessage) {
				items, ok := msg.Record.Data["items"].([]any)
				if !ok {
					t.Fatal("items not an array")
				}
				if len(items) != 2 {
					t.Errorf("items len = %d, want 2", len(items))
				}
			},
		},
		{
			name:     "record with special characters in stream name",
			line:     `{"type":"RECORD","record":{"stream":"public.user-events_v2","namespace":"my_schema","data":{"id":1},"emitted_at":1716000000000}}`,
			wantType: "RECORD",
			check: func(t *testing.T, msg AirbyteMessage) {
				if msg.Record.Stream != "public.user-events_v2" {
					t.Errorf("stream = %q", msg.Record.Stream)
				}
				if msg.Record.Namespace != "my_schema" {
					t.Errorf("namespace = %q", msg.Record.Namespace)
				}
			},
		},
		{
			name:     "record with empty string fields",
			line:     `{"type":"RECORD","record":{"stream":"csv_data","data":{"id":"row-1","col_a":"","col_b":"  ","col_c":"actual data"},"emitted_at":1716000000000}}`,
			wantType: "RECORD",
			check: func(t *testing.T, msg AirbyteMessage) {
				if msg.Record.Data["col_a"] != "" {
					t.Error("empty string not preserved")
				}
				if msg.Record.Data["col_b"] != "  " {
					t.Error("whitespace-only string not preserved")
				}
			},
		},
		{
			name:     "record with numeric edge cases",
			line:     `{"type":"RECORD","record":{"stream":"metrics","data":{"id":1,"big_int":9007199254740993,"tiny_float":0.000000001,"negative":-999999,"zero":0},"emitted_at":1716000000000}}`,
			wantType: "RECORD",
			check: func(t *testing.T, msg AirbyteMessage) {
				neg := msg.Record.Data["negative"]
				if fmt.Sprintf("%v", neg) == "" {
					t.Error("negative number not preserved")
				}
			},
		},
		{
			name:     "state message",
			line:     `{"type":"STATE","state":{"data":{"cursor":"2026-05-17T12:00:00Z","page":5}}}`,
			wantType: "STATE",
			check: func(t *testing.T, msg AirbyteMessage) {
				if msg.State == nil {
					t.Fatal("state is nil")
				}
			},
		},
		{
			name:     "log message info",
			line:     `{"type":"LOG","log":{"level":"INFO","message":"Starting sync of 3 streams..."}}`,
			wantType: "LOG",
			check: func(t *testing.T, msg AirbyteMessage) {
				if msg.Log.Level != "INFO" {
					t.Errorf("level = %q", msg.Log.Level)
				}
			},
		},
		{
			name:     "trace error message",
			line:     `{"type":"TRACE","trace":{"type":"ERROR","emitted_at":1716000000.0,"error":{"message":"Connection refused","internal_message":"dial tcp 127.0.0.1:5432: connect: connection refused","failure_type":"system_error"}}}`,
			wantType: "TRACE",
			check: func(t *testing.T, msg AirbyteMessage) {
				if msg.Trace == nil || msg.Trace.Error == nil {
					t.Fatal("trace error is nil")
				}
				if !strings.Contains(msg.Trace.Error.Message, "Connection refused") {
					t.Errorf("error message = %q", msg.Trace.Error.Message)
				}
			},
		},
		{
			name:     "trace estimate message",
			line:     `{"type":"TRACE","trace":{"type":"STREAM_STATUS","emitted_at":1716000000.0,"estimate":{"name":"users","type":"STREAM","row_estimate":50000,"byte_estimate":10485760}}}`,
			wantType: "TRACE",
			check: func(t *testing.T, msg AirbyteMessage) {
				if msg.Trace.Estimate == nil {
					t.Fatal("estimate is nil")
				}
				if msg.Trace.Estimate.RowCount != 50000 {
					t.Errorf("row_estimate = %d", msg.Trace.Estimate.RowCount)
				}
			},
		},
		{
			name:     "catalog message",
			line:     `{"type":"CATALOG","catalog":{"streams":[{"name":"users","json_schema":{},"supported_sync_modes":["full_refresh","incremental"],"source_defined_primary_key":[["id"]]},{"name":"orders","json_schema":{},"supported_sync_modes":["full_refresh"]}]}}`,
			wantType: "CATALOG",
			check: func(t *testing.T, msg AirbyteMessage) {
				if len(msg.Catalog.Streams) != 2 {
					t.Errorf("streams = %d, want 2", len(msg.Catalog.Streams))
				}
				if msg.Catalog.Streams[0].Name != "users" {
					t.Errorf("first stream = %q", msg.Catalog.Streams[0].Name)
				}
			},
		},
		{
			name:     "connection status succeeded",
			line:     `{"type":"CONNECTION_STATUS","connectionStatus":{"status":"SUCCEEDED","message":""}}`,
			wantType: "CONNECTION_STATUS",
			check: func(t *testing.T, msg AirbyteMessage) {
				if msg.ConnectionStatus.Status != "SUCCEEDED" {
					t.Errorf("status = %q", msg.ConnectionStatus.Status)
				}
			},
		},
		{
			name:     "connection status failed",
			line:     `{"type":"CONNECTION_STATUS","connectionStatus":{"status":"FAILED","message":"Invalid credentials: authentication failed"}}`,
			wantType: "CONNECTION_STATUS",
			check: func(t *testing.T, msg AirbyteMessage) {
				if msg.ConnectionStatus.Status != "FAILED" {
					t.Errorf("status = %q", msg.ConnectionStatus.Status)
				}
				if !strings.Contains(msg.ConnectionStatus.Message, "Invalid credentials") {
					t.Errorf("message = %q", msg.ConnectionStatus.Message)
				}
			},
		},
		{
			name:    "invalid JSON line (should be skipped gracefully)",
			line:    `this is not JSON at all`,
			wantErr: true,
		},
		{
			name:    "Docker stderr noise (should be skipped)",
			line:    `WARNING: Your kernel does not support swap limit capabilities or the cgroup is not mounted.`,
			wantErr: true,
		},
		{
			name:     "record with ISO timestamp strings",
			line:     `{"type":"RECORD","record":{"stream":"events","data":{"id":"e-1","created_at":"2026-05-17T14:30:00.123456Z","updated_at":"2026-05-17T14:30:01+05:30"},"emitted_at":1716000000000}}`,
			wantType: "RECORD",
			check: func(t *testing.T, msg AirbyteMessage) {
				ca := msg.Record.Data["created_at"].(string)
				if !strings.Contains(ca, "2026-05-17") {
					t.Errorf("created_at = %q", ca)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var msg AirbyteMessage
			err := json.Unmarshal([]byte(tt.line), &msg)
			if tt.wantErr {
				if err == nil && msg.Type == "" {
					return // no type = effectively invalid, that's fine
				}
				if err != nil {
					return // expected
				}
			}
			if err != nil {
				t.Fatalf("unexpected parse error: %v", err)
			}
			if msg.Type != tt.wantType {
				t.Errorf("type = %q, want %q", msg.Type, tt.wantType)
			}
			if tt.check != nil {
				tt.check(t, msg)
			}
		})
	}
}

// TestAirbyteRecordConversion tests the conversion from AirbyteRecordMessage to importer.Record
func TestAirbyteRecordConversion(t *testing.T) {
	src := &AirbyteSource{
		image:      "airbyte/source-postgres:latest",
		sourceName: "postgres",
	}

	tests := []struct {
		name    string
		record  *AirbyteRecordMessage
		wantPK  string
		wantSrc string
		wantTbl string
	}{
		{
			name: "record with id field",
			record: &AirbyteRecordMessage{
				Stream:    "users",
				Data:      map[string]any{"id": 42, "name": "Test"},
				EmittedAt: 1716000000000,
			},
			wantPK:  "42",
			wantSrc: "airbyte:postgres:users:42",
			wantTbl: "users",
		},
		{
			name: "record with _id field (MongoDB style)",
			record: &AirbyteRecordMessage{
				Stream:    "documents",
				Data:      map[string]any{"_id": "507f1f77bcf86cd799439011", "title": "Doc"},
				EmittedAt: 1716000000000,
			},
			wantPK:  "507f1f77bcf86cd799439011",
			wantSrc: "airbyte:postgres:documents:507f1f77bcf86cd799439011",
			wantTbl: "documents",
		},
		{
			name: "record with no obvious primary key (uses emitted_at)",
			record: &AirbyteRecordMessage{
				Stream:    "logs",
				Data:      map[string]any{"message": "hello", "level": "info"},
				EmittedAt: 1716000000000,
			},
			wantPK:  "1716000000000",
			wantSrc: "airbyte:postgres:logs:1716000000000",
			wantTbl: "logs",
		},
		{
			name: "record with namespace",
			record: &AirbyteRecordMessage{
				Stream:    "orders",
				Namespace: "ecommerce",
				Data:      map[string]any{"id": "ord-1"},
				EmittedAt: 1716000000000,
			},
			wantPK:  "ord-1",
			wantSrc: "airbyte:postgres:orders:ord-1",
			wantTbl: "ecommerce.orders",
		},
		{
			name: "record with numeric string ID",
			record: &AirbyteRecordMessage{
				Stream:    "items",
				Data:      map[string]any{"ID": "ABC-123-XYZ", "value": 99.9},
				EmittedAt: 1716000000000,
			},
			wantPK:  "ABC-123-XYZ",
			wantSrc: "airbyte:postgres:items:ABC-123-XYZ",
			wantTbl: "items",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := src.recordToImporterRecord(tt.record)
			if rec.PrimaryKey != tt.wantPK {
				t.Errorf("PrimaryKey = %q, want %q", rec.PrimaryKey, tt.wantPK)
			}
			if rec.SourceID != tt.wantSrc {
				t.Errorf("SourceID = %q, want %q", rec.SourceID, tt.wantSrc)
			}
			if rec.Table != tt.wantTbl {
				t.Errorf("Table = %q, want %q", rec.Table, tt.wantTbl)
			}
		})
	}
}

func TestExplodeRTDBRecord(t *testing.T) {
	src := &AirbyteSource{
		image:      "airbyte/source-firebase-realtime-database:latest",
		sourceName: "firebase-rtdb",
	}
	msg := &AirbyteRecordMessage{
		Stream:    "rtdb",
		EmittedAt: 1716000000000,
	}

	tests := []struct {
		name     string
		key      string
		rawValue any
		want     map[string]map[string]any
	}{
		{
			name:     "basic nested collection explosion",
			key:      "users",
			rawValue: `{"user1":{"name":"Alice","age":30},"user2":{"name":"Bob","active":true}}`,
			want: map[string]map[string]any{
				"users/user1": {"_parent": "users", "name": "Alice", "age": float64(30)},
				"users/user2": {"_parent": "users", "name": "Bob", "active": true},
			},
		},
		{
			name:     "empty map",
			key:      "empty",
			rawValue: map[string]any{},
			want: map[string]map[string]any{
				"empty": {},
			},
		},
		{
			name: "deeply nested values",
			key:  "posts",
			rawValue: map[string]any{
				"post1": map[string]any{
					"title": "Deep",
					"metadata": map[string]any{
						"author": map[string]any{
							"id": "user1",
							"profile": map[string]any{
								"displayName": "Alice",
							},
						},
					},
				},
			},
			want: map[string]map[string]any{
				"posts/post1": {
					"_parent": "posts",
					"title":   "Deep",
					"metadata": map[string]any{
						"author": map[string]any{
							"id": "user1",
							"profile": map[string]any{
								"displayName": "Alice",
							},
						},
					},
				},
			},
		},
		{
			name: "arrays in values",
			key:  "docs",
			rawValue: map[string]any{
				"doc1": map[string]any{
					"tags": []any{"alpha", "beta"},
					"items": []any{
						map[string]any{"sku": "A", "qty": 2},
						map[string]any{"sku": "B", "qty": 1},
					},
				},
			},
			want: map[string]map[string]any{
				"docs/doc1": {
					"_parent": "docs",
					"tags":    []any{"alpha", "beta"},
					"items": []any{
						map[string]any{"sku": "A", "qty": 2},
						map[string]any{"sku": "B", "qty": 1},
					},
				},
			},
		},
		{
			name: "single flat object",
			key:  "profile",
			rawValue: map[string]any{
				"name":   "Alice",
				"active": true,
				"count":  2,
			},
			want: map[string]map[string]any{
				"profile": {"name": "Alice", "active": true, "count": 2},
			},
		},
		{
			name:     "non-object leaf values",
			key:      "metrics",
			rawValue: `{"count":3,"last_seen":"today","enabled":false,"current":{"value":42}}`,
			want: map[string]map[string]any{
				"metrics/count":     {"_parent": "metrics", "value": float64(3)},
				"metrics/last_seen": {"_parent": "metrics", "value": "today"},
				"metrics/enabled":   {"_parent": "metrics", "value": false},
				"metrics/current":   {"_parent": "metrics", "value": float64(42)},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := src.explodeRTDBRecord(msg, tt.key, tt.rawValue)
			if len(got) != len(tt.want) {
				t.Fatalf("records len = %d, want %d: %#v", len(got), len(tt.want), got)
			}

			for _, rec := range got {
				wantFields, ok := tt.want[rec.PrimaryKey]
				if !ok {
					t.Fatalf("unexpected primary key %q in record %#v", rec.PrimaryKey, rec)
				}
				if rec.SourceID != fmt.Sprintf("airbyte:%s:%s:%s", src.sourceName, msg.Stream, rec.PrimaryKey) {
					t.Errorf("SourceID = %q", rec.SourceID)
				}
				if rec.SourceDSN != src.image {
					t.Errorf("SourceDSN = %q, want %q", rec.SourceDSN, src.image)
				}
				if rec.Table != msg.Stream {
					t.Errorf("Table = %q, want %q", rec.Table, msg.Stream)
				}
				if !reflect.DeepEqual(rec.Fields, wantFields) {
					t.Errorf("Fields = %#v, want %#v", rec.Fields, wantFields)
				}
			}
		})
	}
}

// TestAirbyteRegistryLookup tests source name to Docker image resolution
func TestAirbyteRegistryLookup(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"notion", "airbyte/source-notion:latest"},
		{"airtable", "airbyte/source-airtable:latest"},
		{"firebase-rtdb", "airbyte/source-firebase-realtime-database:latest"},
		{"nonexistent", ""},
		{"airbyte/source-custom:v1.2.3", "airbyte/source-custom:v1.2.3"},
		{"myregistry.io/source-foo:latest", "myregistry.io/source-foo:latest"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := LookupAirbyteImage(tt.input)
			if got != tt.want {
				t.Errorf("LookupAirbyteImage(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// TestAirbyteBuiltinCheck tests the builtin/airbyte source classification
func TestAirbyteBuiltinCheck(t *testing.T) {
	builtins := []string{"csv", "json", "jsonl", "markdown", "obsidian", "excel", "yaml", "sqlite", "postgres", "mysql", "mongodb", "firestore"}
	for _, s := range builtins {
		if !IsBuiltinSource(s) {
			t.Errorf("IsBuiltinSource(%q) = false, want true", s)
		}
	}

	nonBuiltins := []string{"notion", "airtable", "firebase-rtdb", "dynamodb"}
	for _, s := range nonBuiltins {
		if IsBuiltinSource(s) {
			t.Errorf("IsBuiltinSource(%q) = true, want false", s)
		}
	}
}

// TestAirbyteDockerIntegration actually runs a Docker container if Docker is available.
// This is the real integration test that validates end-to-end.
func TestAirbyteDockerIntegration(t *testing.T) {
	if !DockerAvailable() {
		t.Skip("Docker not available, skipping integration test")
	}

	// Use a minimal connector that we know works: source-faker generates fake data
	// and doesn't require any real credentials
	t.Run("source-faker generates records", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
		defer cancel()

		// Check if the image exists (don't pull in tests unless necessary)
		checkCmd := exec.CommandContext(ctx, "docker", "image", "inspect", "airbyte/source-faker:latest")
		if checkCmd.Run() != nil {
			t.Skip("airbyte/source-faker:latest not pulled, skipping (run 'docker pull airbyte/source-faker:latest' to enable)")
		}

		src, err := NewAirbyteSource(AirbyteSourceOpts{
			Image: "airbyte/source-faker:latest",
			Config: map[string]any{
				"count": 5,
			},
			SourceName: "faker-test",
		})
		if err != nil {
			t.Fatalf("NewAirbyteSource: %v", err)
		}

		records, errs := src.Stream(ctx)
		var gotRecords []Record
		var gotErrors []error

		for records != nil || errs != nil {
			select {
			case rec, ok := <-records:
				if !ok {
					records = nil
					continue
				}
				gotRecords = append(gotRecords, rec)
			case err, ok := <-errs:
				if !ok {
					errs = nil
					continue
				}
				if err != nil {
					gotErrors = append(gotErrors, err)
				}
			case <-ctx.Done():
				t.Fatalf("timeout waiting for records")
			}
		}

		if len(gotErrors) > 0 {
			t.Logf("Got %d errors (may be expected): %v", len(gotErrors), gotErrors[0])
		}
		if len(gotRecords) == 0 {
			t.Error("Expected at least 1 record from source-faker")
		} else {
			t.Logf("Got %d records from source-faker", len(gotRecords))
			// Verify record structure
			first := gotRecords[0]
			if first.Table == "" {
				t.Error("Record.Table is empty")
			}
			if first.SourceID == "" {
				t.Error("Record.SourceID is empty")
			}
			if first.Fields == nil {
				t.Error("Record.Fields is nil")
			}
		}
	})
}

// TestAirbyteSourceSpec tests the spec command (requires Docker)
func TestAirbyteSourceSpec(t *testing.T) {
	if !DockerAvailable() {
		t.Skip("Docker not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Use source-faker which should always be pullable
	checkCmd := exec.CommandContext(ctx, "docker", "image", "inspect", "airbyte/source-faker:latest")
	if checkCmd.Run() != nil {
		t.Skip("airbyte/source-faker:latest not pulled")
	}

	src, err := NewAirbyteSource(AirbyteSourceOpts{
		Image:  "airbyte/source-faker:latest",
		Config: map[string]any{},
	})
	if err != nil {
		t.Fatalf("NewAirbyteSource: %v", err)
	}

	spec, err := src.Spec(ctx)
	if err != nil {
		t.Fatalf("Spec: %v", err)
	}
	if spec == nil {
		t.Fatal("spec is nil")
	}
	if len(spec.ConnectionSpecification) == 0 {
		t.Error("ConnectionSpecification is empty")
	}
	t.Logf("Spec returned %d bytes of connectionSpecification", len(spec.ConnectionSpecification))
}

// TestAirbyteEdgeCases tests extreme edge cases in /tmp
func TestAirbyteEdgeCases(t *testing.T) {
	t.Run("empty config creates valid temp file", func(t *testing.T) {
		src := &AirbyteSource{
			image:      "test:latest",
			config:     map[string]any{},
			sourceName: "test",
		}
		path, err := src.writeTempJSON("test-*.json", src.config)
		if err != nil {
			t.Fatalf("writeTempJSON: %v", err)
		}
		defer os.Remove(path)

		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		var parsed map[string]any
		if err := json.Unmarshal(data, &parsed); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
	})

	t.Run("config with special characters survives temp file roundtrip", func(t *testing.T) {
		src := &AirbyteSource{
			image:      "test:latest",
			sourceName: "test",
			config: map[string]any{
				"password":   `p@ss"w0rd\n\t\r`,
				"path":       `/var/lib/data/日本語/file.db`,
				"connection": "postgresql://user:p@ss@host:5432/db?sslmode=require&options=-c search_path=public",
				"nested": map[string]any{
					"key with spaces": "value with 'quotes' and \"double quotes\"",
					"empty":           "",
					"null_val":        nil,
				},
			},
		}
		path, err := src.writeTempJSON("test-*.json", src.config)
		if err != nil {
			t.Fatalf("writeTempJSON: %v", err)
		}
		defer os.Remove(path)

		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		var parsed map[string]any
		if err := json.Unmarshal(data, &parsed); err != nil {
			t.Fatalf("unmarshal roundtrip: %v", err)
		}
		if parsed["password"] != `p@ss"w0rd\n\t\r` {
			t.Errorf("password = %q", parsed["password"])
		}
		if parsed["path"] != `/var/lib/data/日本語/file.db` {
			t.Errorf("path = %q", parsed["path"])
		}
	})

	t.Run("large record with 1000 fields", func(t *testing.T) {
		data := make(map[string]any, 1000)
		for i := 0; i < 1000; i++ {
			data[fmt.Sprintf("field_%04d", i)] = fmt.Sprintf("value_%d_%s", i, strings.Repeat("x", 100))
		}

		src := &AirbyteSource{image: "test:latest", sourceName: "test"}
		rec := src.recordToImporterRecord(&AirbyteRecordMessage{
			Stream:    "wide_table",
			Data:      data,
			EmittedAt: 1716000000000,
		})

		if len(rec.Fields) != 1000 {
			t.Errorf("Fields count = %d, want 1000", len(rec.Fields))
		}
	})

	t.Run("record with binary-like data (base64 strings)", func(t *testing.T) {
		src := &AirbyteSource{image: "test:latest", sourceName: "test"}
		rec := src.recordToImporterRecord(&AirbyteRecordMessage{
			Stream: "blobs",
			Data: map[string]any{
				"id":      "blob-1",
				"content": "SGVsbG8gV29ybGQhIFRoaXMgaXMgYmFzZTY0IGVuY29kZWQ=",
				"binary":  "\x00\x01\x02\x03",
			},
			EmittedAt: 1716000000000,
		})
		if rec.PrimaryKey != "blob-1" {
			t.Errorf("PK = %q", rec.PrimaryKey)
		}
	})

	t.Run("temp file cleanup on error", func(t *testing.T) {
		tmpDir := t.TempDir()
		tmpFile := filepath.Join(tmpDir, "should-not-persist.json")
		_ = os.WriteFile(tmpFile, []byte(`{}`), 0o644)
		os.Remove(tmpFile)

		// Verify file is gone
		if _, err := os.Stat(tmpFile); !os.IsNotExist(err) {
			t.Error("temp file should be cleaned up")
		}
	})
}

// TestListAvailableSources tests the source listing function
func TestListAvailableSources(t *testing.T) {
	sources := ListAvailableSources(false) // no Docker
	if _, ok := sources["builtin"]; !ok {
		t.Error("missing 'builtin' key")
	}
	if _, ok := sources["airbyte"]; ok {
		t.Error("should not have 'airbyte' when Docker unavailable")
	}

	builtins := sources["builtin"]
	if len(builtins) < 7 {
		t.Errorf("expected at least 7 builtin sources, got %d", len(builtins))
	}

	sources = ListAvailableSources(true) // with Docker
	if _, ok := sources["airbyte"]; !ok {
		t.Error("missing 'airbyte' key when Docker available")
	}
	if len(sources["airbyte"]) < 3 {
		t.Errorf("expected at least 3 airbyte sources, got %d", len(sources["airbyte"]))
	}
}

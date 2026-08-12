package schema

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// DefaultDiscriminator is the frontmatter field consulted to pick a schema
// when none is configured.
const DefaultDiscriminator = "type"

type Validator struct {
	mu            sync.RWMutex
	schemas       map[string]*jsonschema.Schema
	root          string
	discriminator string
}

type ValidationError struct {
	Type   string   `json:"type"`
	Errors []string `json:"errors"`
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("validation failed for type %q: %s", e.Type, strings.Join(e.Errors, "; "))
}

func NewValidator(root string) *Validator {
	return NewValidatorWithDiscriminator(root, DefaultDiscriminator)
}

// NewValidatorWithDiscriminator builds a validator that selects
// .kiwi/schemas/{value}.json using the named frontmatter field. Workspaces
// that type their pages with something other than `type` (`kind`, `category`)
// need this or no schema ever matches.
func NewValidatorWithDiscriminator(root, discriminator string) *Validator {
	if discriminator == "" {
		discriminator = DefaultDiscriminator
	}
	v := &Validator{
		schemas:       make(map[string]*jsonschema.Schema),
		root:          root,
		discriminator: discriminator,
	}
	v.loadSchemas()
	return v
}

// Discriminator reports the frontmatter field this validator keys on.
func (v *Validator) Discriminator() string {
	if v == nil || v.discriminator == "" {
		return DefaultDiscriminator
	}
	return v.discriminator
}

func (v *Validator) loadSchemas() {
	dir := filepath.Join(v.root, ".kiwi", "schemas")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	compiler := jsonschema.NewCompiler()
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		typeName := strings.TrimSuffix(entry.Name(), ".json")
		path := filepath.Join(dir, entry.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			log.Printf("schema: read %s: %v", path, err)
			continue
		}
		var raw any
		if err := json.Unmarshal(data, &raw); err != nil {
			log.Printf("schema: parse %s: %v", path, err)
			continue
		}
		url := "file:///" + typeName + ".json"
		if err := compiler.AddResource(url, raw); err != nil {
			log.Printf("schema: add resource %s: %v", typeName, err)
			continue
		}
		sch, err := compiler.Compile(url)
		if err != nil {
			log.Printf("schema: compile %s: %v", typeName, err)
			continue
		}
		v.mu.Lock()
		v.schemas[typeName] = sch
		v.mu.Unlock()
	}
}

func (v *Validator) Reload() {
	v.mu.Lock()
	v.schemas = make(map[string]*jsonschema.Schema)
	v.mu.Unlock()
	v.loadSchemas()
}

func (v *Validator) Validate(frontmatter map[string]any) *ValidationError {
	if v == nil {
		return nil
	}
	typeName, ok := frontmatter[v.Discriminator()].(string)
	if !ok || typeName == "" {
		return nil
	}

	v.mu.RLock()
	sch, exists := v.schemas[typeName]
	v.mu.RUnlock()

	if !exists {
		return nil
	}

	err := sch.Validate(normalizeForSchema(frontmatter))
	if err == nil {
		return nil
	}

	var errs []string
	if ve, ok := err.(*jsonschema.ValidationError); ok {
		for _, cause := range ve.Causes {
			errs = append(errs, cause.Error())
		}
		if len(errs) == 0 {
			errs = append(errs, ve.Error())
		}
	} else {
		errs = append(errs, err.Error())
	}

	return &ValidationError{Type: typeName, Errors: errs}
}

// normalizeForSchema converts YAML-parsed values into the JSON-like shapes
// jsonschema accepts. goldmark-meta decodes nested mappings as map[any]any,
// which the validator rejects outright as an unknown type — so without this
// any schema describing a nested object fails on valid input.
func normalizeForSchema(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			out[k] = normalizeForSchema(val)
		}
		return out
	case map[any]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			ks, ok := k.(string)
			if !ok {
				ks = fmt.Sprint(k)
			}
			out[ks] = normalizeForSchema(val)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, x := range t {
			out[i] = normalizeForSchema(x)
		}
		return out
	default:
		return v
	}
}

func (v *Validator) ListTypes() []string {
	v.mu.RLock()
	defer v.mu.RUnlock()
	types := make([]string, 0, len(v.schemas))
	for t := range v.schemas {
		types = append(types, t)
	}
	return types
}

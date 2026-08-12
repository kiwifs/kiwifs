package schema

import (
	"os"
	"path/filepath"
	"testing"
)

func writeSchema(t *testing.T, root, name, body string) {
	t.Helper()
	dir := filepath.Join(root, ".kiwi", "schemas")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir schemas: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, name+".json"), []byte(body), 0o644); err != nil {
		t.Fatalf("write schema %s: %v", name, err)
	}
}

const nestedSchema = `{
  "type": "object",
  "required": ["author"],
  "properties": {
    "author": {
      "type": "object",
      "required": ["role"],
      "properties": {
        "role": {"enum": ["owner", "reviewer", "unknown"]},
        "team-size": {"type": "integer", "minimum": 0}
      }
    }
  }
}`

// Frontmatter arrives from goldmark-meta with nested mappings typed as
// map[any]any. Passing that to jsonschema unnormalized fails as an unknown
// type, so a valid page gets rejected and an invalid one is never inspected.
func TestValidateNestedObjectFromYAML(t *testing.T) {
	root := t.TempDir()
	writeSchema(t, root, "article", nestedSchema)
	v := NewValidator(root)

	valid := map[string]any{
		"type": "article",
		"author": map[any]any{
			"role":      "owner",
			"team-size": 3,
		},
	}
	if err := v.Validate(valid); err != nil {
		t.Fatalf("valid nested frontmatter rejected: %v", err)
	}

	invalid := map[string]any{
		"type": "article",
		"author": map[any]any{
			"role": "bystander",
		},
	}
	if err := v.Validate(invalid); err == nil {
		t.Fatal("expected nested enum violation to be reported")
	}
}

func TestValidateNestedArrayOfObjects(t *testing.T) {
	root := t.TempDir()
	writeSchema(t, root, "article", `{
	  "type": "object",
	  "properties": {
	    "reviews": {
	      "type": "array",
	      "items": {"type": "object", "required": ["reviewer"]}
	    }
	  }
	}`)
	v := NewValidator(root)

	ok := map[string]any{
		"type":    "article",
		"reviews": []any{map[any]any{"reviewer": "avery"}},
	}
	if err := v.Validate(ok); err != nil {
		t.Fatalf("array of nested objects rejected: %v", err)
	}

	bad := map[string]any{
		"type":    "article",
		"reviews": []any{map[any]any{"rating": 4}},
	}
	if err := v.Validate(bad); err == nil {
		t.Fatal("expected missing required property inside array item")
	}
}

func TestValidateMissingRequiredField(t *testing.T) {
	root := t.TempDir()
	writeSchema(t, root, "article", nestedSchema)
	v := NewValidator(root)

	err := v.Validate(map[string]any{"type": "article"})
	if err == nil {
		t.Fatal("expected missing author to fail")
	}
	if err.Type != "article" {
		t.Fatalf("Type = %q, want %q", err.Type, "article")
	}
	if len(err.Errors) == 0 {
		t.Fatal("expected at least one error detail")
	}
}

func TestDefaultDiscriminatorIsType(t *testing.T) {
	root := t.TempDir()
	writeSchema(t, root, "article", nestedSchema)
	v := NewValidator(root)

	if got := v.Discriminator(); got != DefaultDiscriminator {
		t.Fatalf("Discriminator() = %q, want %q", got, DefaultDiscriminator)
	}
	// Keyed on `kind`, so the default validator must not match this page.
	if err := v.Validate(map[string]any{"kind": "article"}); err != nil {
		t.Fatalf("kind-typed page should be ignored by default: %v", err)
	}
}

func TestCustomDiscriminator(t *testing.T) {
	root := t.TempDir()
	writeSchema(t, root, "article", nestedSchema)
	v := NewValidatorWithDiscriminator(root, "kind")

	if err := v.Validate(map[string]any{"kind": "article"}); err == nil {
		t.Fatal("expected kind-typed page to be validated and fail")
	}
	// The old discriminator must stop matching once it is overridden.
	if err := v.Validate(map[string]any{"type": "article"}); err != nil {
		t.Fatalf("type-typed page should be ignored under kind: %v", err)
	}
}

func TestEmptyDiscriminatorFallsBackToDefault(t *testing.T) {
	root := t.TempDir()
	writeSchema(t, root, "article", nestedSchema)
	v := NewValidatorWithDiscriminator(root, "")

	if got := v.Discriminator(); got != DefaultDiscriminator {
		t.Fatalf("Discriminator() = %q, want %q", got, DefaultDiscriminator)
	}
}

func TestValidateSkipsUnknownAndUntyped(t *testing.T) {
	root := t.TempDir()
	writeSchema(t, root, "article", nestedSchema)
	v := NewValidator(root)

	cases := []struct {
		name string
		fm   map[string]any
	}{
		{"no discriminator", map[string]any{"title": "x"}},
		{"empty discriminator", map[string]any{"type": ""}},
		{"non-string discriminator", map[string]any{"type": 7}},
		{"no schema for type", map[string]any{"type": "nonexistent"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := v.Validate(tc.fm); err != nil {
				t.Fatalf("expected no validation, got %v", err)
			}
		})
	}
}

// Required fields can depend on status via JSON Schema if/then, which is what
// lets a page be incomplete as a draft but not once it claims to be verified.
func TestConditionalRequiredByStatus(t *testing.T) {
	root := t.TempDir()
	writeSchema(t, root, "article", `{
	  "type": "object",
	  "properties": {"status": {"type": "string"}},
	  "allOf": [{
	    "if": {"properties": {"status": {"const": "verified"}}, "required": ["status"]},
	    "then": {"required": ["last-reviewed", "source-uri"]}
	  }]
	}`)
	v := NewValidator(root)

	if err := v.Validate(map[string]any{"type": "article", "status": "draft"}); err != nil {
		t.Fatalf("draft with holes should pass: %v", err)
	}
	if err := v.Validate(map[string]any{"type": "article", "status": "verified"}); err == nil {
		t.Fatal("verified page missing required fields should fail")
	}
	ok := map[string]any{
		"type":          "article",
		"status":        "verified",
		"last-reviewed": "2026-08-11",
		"source-uri":    "https://example.com",
	}
	if err := v.Validate(ok); err != nil {
		t.Fatalf("complete verified page rejected: %v", err)
	}
}

func TestNilValidatorIsInert(t *testing.T) {
	var v *Validator
	if err := v.Validate(map[string]any{"type": "article"}); err != nil {
		t.Fatalf("nil validator should not validate: %v", err)
	}
	if got := v.Discriminator(); got != DefaultDiscriminator {
		t.Fatalf("Discriminator() = %q, want %q", got, DefaultDiscriminator)
	}
}

func TestReloadPicksUpNewSchema(t *testing.T) {
	root := t.TempDir()
	v := NewValidator(root)
	if err := v.Validate(map[string]any{"type": "article"}); err != nil {
		t.Fatalf("no schemas yet, expected pass: %v", err)
	}

	writeSchema(t, root, "article", nestedSchema)
	v.Reload()

	if err := v.Validate(map[string]any{"type": "article"}); err == nil {
		t.Fatal("expected reloaded schema to be enforced")
	}
	if types := v.ListTypes(); len(types) != 1 || types[0] != "article" {
		t.Fatalf("ListTypes() = %v, want [article]", types)
	}
}

func TestNormalizeForSchemaCoercesNonStringKeys(t *testing.T) {
	got := normalizeForSchema(map[any]any{
		1:    "one",
		true: "yes",
		"n":  map[any]any{"deep": []any{map[any]any{"k": "v"}}},
	})
	m, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("got %T, want map[string]any", got)
	}
	if m["1"] != "one" || m["true"] != "yes" {
		t.Fatalf("non-string keys not stringified: %#v", m)
	}
	deep := m["n"].(map[string]any)["deep"].([]any)[0]
	if _, ok := deep.(map[string]any); !ok {
		t.Fatalf("nested map inside slice not normalized: %T", deep)
	}
}

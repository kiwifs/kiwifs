package memory

import "testing"

func TestMemoryStatus_DefaultsToActive(t *testing.T) {
	if got := MemoryStatus(nil); got != StatusActive {
		t.Fatalf("nil fm: got %q", got)
	}
	if got := MemoryStatus(map[string]any{}); got != StatusActive {
		t.Fatalf("empty fm: got %q", got)
	}
}

func TestMemoryStatus_RecognisedValues(t *testing.T) {
	fm := map[string]any{"memory_status": "Superseded"}
	if got := MemoryStatus(fm); got != StatusSuperseded {
		t.Fatalf("got %q, want %q", got, StatusSuperseded)
	}
}

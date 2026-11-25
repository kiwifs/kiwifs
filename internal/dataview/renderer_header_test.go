package dataview

import "testing"

func TestFormatColumnHeaderNonASCII(t *testing.T) {
	for in, want := range map[string]string{
		"état_projet":         "État Projet",
		"_word_count":         "Word Count",
		"mastery.derivatives": "Mastery Derivatives",
		"日付":                  "日付",
	} {
		if got := formatColumnHeader(in); got != want {
			t.Errorf("formatColumnHeader(%q) = %q, want %q", in, got, want)
		}
	}
}

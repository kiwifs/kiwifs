package cmd

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"runtime"
	"strings"
	"testing"
)

func TestAssetNameForPlatform(t *testing.T) {
	name := assetNameForPlatform()

	// Must use hyphens, not underscores — goreleaser v2 normalises to hyphens.
	if strings.Contains(name, "_") {
		t.Errorf("asset name %q contains underscores; goreleaser v2 uses hyphens", name)
	}

	// Must be lowercase — goreleaser v2 does not title-case OS names.
	if name != strings.ToLower(name) {
		t.Errorf("asset name %q is not fully lowercase", name)
	}

	// Must contain the current OS and arch.
	if !strings.Contains(name, runtime.GOOS) {
		t.Errorf("asset name %q missing GOOS %q", name, runtime.GOOS)
	}
	if !strings.Contains(name, runtime.GOARCH) {
		t.Errorf("asset name %q missing GOARCH %q", name, runtime.GOARCH)
	}

	// Must match real release asset naming pattern.
	want := "kiwifs-" + runtime.GOOS + "-" + runtime.GOARCH
	if name != want {
		t.Errorf("assetNameForPlatform() = %q, want %q", name, want)
	}
}

func TestAssetNameMatchesReleaseAssets(t *testing.T) {
	// These are the actual asset names from goreleaser v2 releases.
	// If goreleaser config changes, update these and the code together.
	knownAssets := []string{
		"kiwifs-darwin-amd64.tar.gz",
		"kiwifs-darwin-arm64.tar.gz",
		"kiwifs-linux-amd64.tar.gz",
		"kiwifs-linux-arm64.tar.gz",
	}

	name := assetNameForPlatform()
	found := false
	for _, asset := range knownAssets {
		if strings.Contains(asset, name) {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("assetNameForPlatform() = %q does not match any known release asset %v", name, knownAssets)
	}
}

func TestIsKiwifsBinary(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{"kiwifs", true},
		{"kiwifs.exe", true},
		{"kiwifs-darwin-arm64", true},
		{"kiwifs-linux-amd64", true},
		{"kiwifs_Linux_amd64", true},
		{"subdir/kiwifs", true},
		{"subdir/kiwifs-darwin-arm64", true},
		{"README.md", false},
		{"LICENSE", false},
		{"checksums.txt", false},
		{"", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isKiwifsBinary(tt.name); got != tt.want {
				t.Errorf("isKiwifsBinary(%q) = %v, want %v", tt.name, got, tt.want)
			}
		})
	}
}

func makeTarGz(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)
	for name, data := range files {
		hdr := &tar.Header{
			Name:     name,
			Size:     int64(len(data)),
			Mode:     0755,
			Typeflag: tar.TypeReg,
		}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	tw.Close()
	gw.Close()
	return buf.Bytes()
}

func makeZip(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, data := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	zw.Close()
	return buf.Bytes()
}

func TestExtractBinaryTarGz(t *testing.T) {
	binaryContent := []byte("FAKE_ELF_BINARY")

	tests := []struct {
		name      string
		files     map[string][]byte
		assetName string
		wantErr   bool
	}{
		{
			name:      "binary named kiwifs",
			files:     map[string][]byte{"kiwifs": binaryContent},
			assetName: "kiwifs-linux-amd64.tar.gz",
		},
		{
			name:      "binary with platform suffix (goreleaser v2 actual)",
			files:     map[string][]byte{"kiwifs-linux-amd64": binaryContent},
			assetName: "kiwifs-linux-amd64.tar.gz",
		},
		{
			name:      "binary in subdirectory",
			files:     map[string][]byte{"kiwifs-linux-amd64/kiwifs": binaryContent},
			assetName: "kiwifs-linux-amd64.tar.gz",
		},
		{
			name:      "no kiwifs binary",
			files:     map[string][]byte{"README.md": []byte("hello")},
			assetName: "kiwifs-linux-amd64.tar.gz",
			wantErr:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			archive := makeTarGz(t, tt.files)
			got, err := extractBinary(archive, tt.assetName)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !bytes.Equal(got, binaryContent) {
				t.Errorf("extracted content = %q, want %q", got, binaryContent)
			}
		})
	}
}

func TestExtractBinaryZip(t *testing.T) {
	binaryContent := []byte("FAKE_PE_BINARY")

	tests := []struct {
		name      string
		files     map[string][]byte
		assetName string
		wantErr   bool
	}{
		{
			name:      "binary named kiwifs.exe",
			files:     map[string][]byte{"kiwifs.exe": binaryContent},
			assetName: "kiwifs-windows-amd64.zip",
		},
		{
			name:      "binary with platform suffix",
			files:     map[string][]byte{"kiwifs-windows-amd64.exe": binaryContent},
			assetName: "kiwifs-windows-amd64.zip",
		},
		{
			name:      "no kiwifs binary",
			files:     map[string][]byte{"README.md": []byte("hello")},
			assetName: "kiwifs-windows-amd64.zip",
			wantErr:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			archive := makeZip(t, tt.files)
			got, err := extractBinary(archive, tt.assetName)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !bytes.Equal(got, binaryContent) {
				t.Errorf("extracted content = %q, want %q", got, binaryContent)
			}
		})
	}
}

func TestExtractBinaryUnknownFormat(t *testing.T) {
	_, err := extractBinary([]byte("data"), "kiwifs-linux-amd64.deb")
	if err == nil {
		t.Fatal("expected error for unknown format")
	}
	if !strings.Contains(err.Error(), "unrecognised archive format") {
		t.Errorf("unexpected error: %v", err)
	}
}

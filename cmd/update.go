package cmd

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

var updateCmd = &cobra.Command{
	Use:   "update",
	Short: "Update kiwifs to the latest version",
	Long: `Download and install the latest kiwifs binary.

Checks GitHub Releases for the newest version and replaces the
currently running binary in-place.`,
	RunE: runUpdate,
}

// ---------------------------------------------------------------------------
// Version check (called on every invocation, async + cached)
// ---------------------------------------------------------------------------

type versionCache struct {
	LatestVersion string `json:"latest_version"`
	DownloadURL   string `json:"download_url,omitempty"`
	CheckedAt     string `json:"checked_at"`
}

func versionCachePath() string {
	return credDir() + "/version-cache.json"
}

func loadVersionCache() *versionCache {
	data, err := os.ReadFile(versionCachePath())
	if err != nil {
		return nil
	}
	var vc versionCache
	if err := json.Unmarshal(data, &vc); err != nil {
		return nil
	}
	t, err := time.Parse(time.RFC3339, vc.CheckedAt)
	if err != nil || time.Since(t) > 24*time.Hour {
		return nil
	}
	return &vc
}

func saveVersionCache(vc *versionCache) {
	vc.CheckedAt = time.Now().Format(time.RFC3339)
	data, err := json.MarshalIndent(vc, "", "  ")
	if err != nil {
		return
	}
	os.MkdirAll(credDir(), 0700)
	os.WriteFile(versionCachePath(), data, 0644)
}

type githubRelease struct {
	TagName string        `json:"tag_name"`
	Assets  []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

const githubReleaseURL = "https://api.github.com/repos/kiwifs/kiwifs/releases/latest"

func fetchLatestRelease() (*githubRelease, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(githubReleaseURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub API returned %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	var rel githubRelease
	if err := json.Unmarshal(body, &rel); err != nil {
		return nil, err
	}
	return &rel, nil
}

func normalizeVersion(v string) string {
	return strings.TrimPrefix(v, "v")
}

// assetNameForPlatform returns the base name used in goreleaser release
// archives. Despite the goreleaser name_template using underscores,
// goreleaser v2 normalises the output to hyphens and lowercase OS names,
// e.g. "kiwifs-linux-amd64".
func assetNameForPlatform() string {
	return fmt.Sprintf("kiwifs-%s-%s", runtime.GOOS, runtime.GOARCH)
}

// extractBinary pulls the kiwifs executable out of a downloaded release archive.
// Goreleaser produces .tar.gz on Linux/macOS and .zip on Windows.
func extractBinary(data []byte, assetName string) ([]byte, error) {
	switch {
	case strings.HasSuffix(assetName, ".tar.gz"):
		gr, err := gzip.NewReader(bytes.NewReader(data))
		if err != nil {
			return nil, fmt.Errorf("open gzip: %w", err)
		}
		defer gr.Close()
		tr := tar.NewReader(gr)
		for {
			hdr, err := tr.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				return nil, fmt.Errorf("read tar: %w", err)
			}
			if filepath.Base(hdr.Name) == "kiwifs" {
				return io.ReadAll(tr)
			}
		}
		return nil, fmt.Errorf("kiwifs binary not found in tar.gz archive")

	case strings.HasSuffix(assetName, ".zip"):
		zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			return nil, fmt.Errorf("open zip: %w", err)
		}
		for _, f := range zr.File {
			base := filepath.Base(f.Name)
			if base == "kiwifs" || base == "kiwifs.exe" {
				rc, err := f.Open()
				if err != nil {
					return nil, err
				}
				defer rc.Close()
				return io.ReadAll(rc)
			}
		}
		return nil, fmt.Errorf("kiwifs binary not found in zip archive")

	default:
		return nil, fmt.Errorf("unrecognised archive format for asset %q", assetName)
	}
}

// CheckVersionAsync prints a warning to stderr if a newer version is available.
// It uses a 24h file cache and never blocks.
func CheckVersionAsync() {
	if Version == "dev" {
		return
	}

	go func() {
		cached := loadVersionCache()
		if cached != nil {
			if normalizeVersion(cached.LatestVersion) != normalizeVersion(Version) {
				printUpdateHint(cached.LatestVersion)
			}
			return
		}

		rel, err := fetchLatestRelease()
		if err != nil {
			return
		}

		vc := &versionCache{LatestVersion: rel.TagName}
		for _, a := range rel.Assets {
			if strings.Contains(a.Name, assetNameForPlatform()) {
				vc.DownloadURL = a.BrowserDownloadURL
				break
			}
		}
		saveVersionCache(vc)

		if normalizeVersion(rel.TagName) != normalizeVersion(Version) {
			printUpdateHint(rel.TagName)
		}
	}()
}

func printUpdateHint(latest string) {
	fmt.Fprintf(os.Stderr, "\n  kiwifs %s is available (you have %s). Run: kiwifs update\n\n", latest, Version)
}

// ---------------------------------------------------------------------------
// kiwifs update command
// ---------------------------------------------------------------------------

func runUpdate(cmd *cobra.Command, args []string) error {
	fmt.Fprintf(os.Stderr, "Current version: %s\n", Version)
	fmt.Fprintf(os.Stderr, "Checking for updates...\n")

	rel, err := fetchLatestRelease()
	if err != nil {
		return fmt.Errorf("check for updates: %w", err)
	}

	latest := normalizeVersion(rel.TagName)
	current := normalizeVersion(Version)

	if latest == current {
		fmt.Fprintf(os.Stderr, "Already up to date (%s)\n", Version)
		return nil
	}

	fmt.Fprintf(os.Stderr, "New version available: %s → %s\n\n", current, latest)

	wantAsset := assetNameForPlatform()
	var downloadURL, assetName string
	for _, a := range rel.Assets {
		if strings.Contains(a.Name, wantAsset) {
			downloadURL = a.BrowserDownloadURL
			assetName = a.Name
			break
		}
	}

	if downloadURL == "" {
		fmt.Fprintf(os.Stderr, "No binary found for %s/%s in the release.\n", runtime.GOOS, runtime.GOARCH)
		fmt.Fprintf(os.Stderr, "Manual install options:\n")
		fmt.Fprintf(os.Stderr, "  npm:  npm install -g kiwifs@latest\n")
		fmt.Fprintf(os.Stderr, "  go:   go install github.com/kiwifs/kiwifs@latest\n")
		return nil
	}

	fmt.Fprintf(os.Stderr, "Downloading %s...\n", downloadURL)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Get(downloadURL)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("download failed: HTTP %d", resp.StatusCode)
	}

	archiveData, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read download: %w", err)
	}

	binaryData, err := extractBinary(archiveData, assetName)
	if err != nil {
		return fmt.Errorf("extract binary: %w", err)
	}

	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("find current binary: %w", err)
	}

	// Atomic replace: write to temp, rename over current
	tmpPath := execPath + ".tmp"
	if err := os.WriteFile(tmpPath, binaryData, 0755); err != nil {
		return fmt.Errorf("write temp binary: %w", err)
	}

	if err := os.Rename(tmpPath, execPath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("replace binary: %w\n\nYou may need to run with sudo or update via npm/go install", err)
	}

	// Clear version cache so the hint disappears
	os.Remove(versionCachePath())

	fmt.Fprintf(os.Stderr, "\nUpdated to %s\n", latest)
	return nil
}

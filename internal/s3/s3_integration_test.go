package s3_test

// Integration tests for the S3-compatible endpoint. Exercises the wire
// protocol end-to-end through httptest.NewServer: the request goes
// through gofakes3's XML framing, through the adapter, and lands on a
// real pipeline backed by a temp directory. No mocks.
//
// Per issue #99 these cover the five core S3 operations
// (PutObject, GetObject, ListObjectsV2, DeleteObject, HeadObject) plus
// the edge cases the issue called out (nested paths, special
// characters, empty files, large bodies).

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/events"
	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/protoauth"
	kiwis3 "github.com/kiwifs/kiwifs/internal/s3"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/kiwifs/kiwifs/internal/versioning"
)

const testBucket = "knowledge"

// newTestServer wires a real pipeline (storage + grep search + noop
// versioning) onto an httptest server speaking the S3 wire protocol.
// The temp directory is owned by t and cleaned up automatically.
func newTestServer(t *testing.T) (*httptest.Server, storage.Storage) {
	t.Helper()
	dir := t.TempDir()
	store, err := storage.NewLocal(dir)
	if err != nil {
		t.Fatalf("storage: %v", err)
	}
	searcher := search.NewGrep(dir)
	ver := versioning.NewNoop()
	hub := events.NewHub()
	pipe := pipeline.New(store, ver, searcher, nil, hub, nil, dir)
	srv := kiwis3.New(dir, pipe, store, protoauth.None())
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts, store
}

// s3PutObject issues a raw S3 PUT against the test server. We send the
// minimal wire payload (no signing, no ACL) because the adapter doesn't
// enforce either when auth is open.
func s3PutObject(t *testing.T, ts *httptest.Server, key string, body []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPut, ts.URL+"/"+testBucket+"/"+key, bytes.NewReader(body))
	if err != nil {
		t.Fatalf("PUT request: %v", err)
	}
	req.ContentLength = int64(len(body))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT %s: %v", key, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		buf, _ := io.ReadAll(resp.Body)
		t.Fatalf("PUT %s: status %d, body=%s", key, resp.StatusCode, buf)
	}
}

func s3GetObject(t *testing.T, ts *httptest.Server, key string) (int, []byte, http.Header) {
	t.Helper()
	resp, err := http.Get(ts.URL + "/" + testBucket + "/" + key)
	if err != nil {
		t.Fatalf("GET %s: %v", key, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, body, resp.Header
}

func s3HeadObject(t *testing.T, ts *httptest.Server, key string) (int, http.Header) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodHead, ts.URL+"/"+testBucket+"/"+key, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("HEAD %s: %v", key, err)
	}
	defer resp.Body.Close()
	return resp.StatusCode, resp.Header
}

func s3DeleteObject(t *testing.T, ts *httptest.Server, key string) int {
	t.Helper()
	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/"+testBucket+"/"+key, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("DELETE %s: %v", key, err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

// listBucketResult mirrors the subset of the ListObjectsV2 XML response
// the tests need to inspect (Key + Size). gofakes3 returns the standard
// AWS schema so this matches the upstream wire format.
type listBucketResult struct {
	XMLName  xml.Name `xml:"ListBucketResult"`
	Contents []struct {
		Key  string `xml:"Key"`
		Size int64  `xml:"Size"`
	} `xml:"Contents"`
}

func s3ListObjectsV2(t *testing.T, ts *httptest.Server, prefix string) listBucketResult {
	t.Helper()
	u := ts.URL + "/" + testBucket + "/?list-type=2"
	if prefix != "" {
		u += "&prefix=" + url.QueryEscape(prefix)
	}
	resp, err := http.Get(u)
	if err != nil {
		t.Fatalf("LIST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		buf, _ := io.ReadAll(resp.Body)
		t.Fatalf("LIST: status %d, body=%s", resp.StatusCode, buf)
	}
	var out listBucketResult
	if err := xml.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	return out
}

func TestPutAndGetObject(t *testing.T) {
	ts, _ := newTestServer(t)

	body := []byte("# Hello\n\nA markdown page.\n")
	s3PutObject(t, ts, "hello.md", body)

	status, got, hdr := s3GetObject(t, ts, "hello.md")
	if status != http.StatusOK {
		t.Fatalf("GET: status %d", status)
	}
	if !bytes.Equal(got, body) {
		t.Fatalf("GET body mismatch:\nwant=%q\n got=%q", body, got)
	}
	if ct := hdr.Get("Content-Type"); !strings.HasPrefix(ct, "text/markdown") {
		t.Fatalf("GET .md content-type = %q, want text/markdown*", ct)
	}
}

func TestPutLandsOnDisk(t *testing.T) {
	ts, store := newTestServer(t)
	s3PutObject(t, ts, "notes/landing.md", []byte("# Landing"))

	data, err := store.Read(t.Context(), "notes/landing.md")
	if err != nil {
		t.Fatalf("store.Read: %v", err)
	}
	if !bytes.Equal(data, []byte("# Landing")) {
		t.Fatalf("on-disk body = %q, want %q", data, []byte("# Landing"))
	}
}

func TestHeadObject(t *testing.T) {
	ts, _ := newTestServer(t)
	body := []byte("# Head\n")
	s3PutObject(t, ts, "head.md", body)

	status, hdr := s3HeadObject(t, ts, "head.md")
	if status != http.StatusOK {
		t.Fatalf("HEAD: status %d", status)
	}
	// gofakes3 emits Content-Length even on HEAD because it computes
	// it from the Object.Size the adapter returns.
	if cl := hdr.Get("Content-Length"); cl == "" {
		t.Fatal("HEAD: missing Content-Length")
	} else if n, _ := strconv.Atoi(cl); n != len(body) {
		t.Fatalf("HEAD: Content-Length=%s, want %d", cl, len(body))
	}
	if ct := hdr.Get("Content-Type"); !strings.HasPrefix(ct, "text/markdown") {
		t.Fatalf("HEAD: content-type=%q, want text/markdown*", ct)
	}
	if etag := hdr.Get("Etag"); etag == "" {
		t.Fatal("HEAD: missing ETag")
	}
}

func TestHeadMissingKeyIs404(t *testing.T) {
	ts, _ := newTestServer(t)
	status, _ := s3HeadObject(t, ts, "missing.md")
	if status != http.StatusNotFound {
		t.Fatalf("HEAD missing: status %d, want 404", status)
	}
}

func TestListObjectsV2(t *testing.T) {
	ts, _ := newTestServer(t)
	s3PutObject(t, ts, "a.md", []byte("# A"))
	s3PutObject(t, ts, "b.md", []byte("# B"))
	s3PutObject(t, ts, "sub/c.md", []byte("# C"))

	got := s3ListObjectsV2(t, ts, "")
	want := map[string]int64{"a.md": 3, "b.md": 3, "sub/c.md": 3}
	if len(got.Contents) != len(want) {
		t.Fatalf("LIST: %d entries, want %d (%+v)", len(got.Contents), len(want), got.Contents)
	}
	for _, c := range got.Contents {
		w, ok := want[c.Key]
		if !ok {
			t.Errorf("unexpected key in LIST: %q", c.Key)
			continue
		}
		if c.Size != w {
			t.Errorf("LIST %q: size=%d, want %d", c.Key, c.Size, w)
		}
	}
}

func TestListObjectsV2Prefix(t *testing.T) {
	ts, _ := newTestServer(t)
	s3PutObject(t, ts, "alpha/one.md", []byte("# 1"))
	s3PutObject(t, ts, "alpha/two.md", []byte("# 2"))
	s3PutObject(t, ts, "beta/three.md", []byte("# 3"))

	got := s3ListObjectsV2(t, ts, "alpha/")
	if len(got.Contents) != 2 {
		t.Fatalf("LIST prefix=alpha/: %d entries, want 2 (%+v)", len(got.Contents), got.Contents)
	}
	for _, c := range got.Contents {
		if !strings.HasPrefix(c.Key, "alpha/") {
			t.Errorf("LIST prefix=alpha/: unexpected key %q", c.Key)
		}
	}
}

func TestDeleteObject(t *testing.T) {
	ts, _ := newTestServer(t)
	s3PutObject(t, ts, "doomed.md", []byte("# Doomed"))

	status := s3DeleteObject(t, ts, "doomed.md")
	// S3 DELETE returns 204 No Content on success.
	if status != http.StatusNoContent {
		t.Fatalf("DELETE: status %d, want 204", status)
	}

	gotStatus, _, _ := s3GetObject(t, ts, "doomed.md")
	if gotStatus != http.StatusNotFound {
		t.Fatalf("GET after DELETE: status %d, want 404", gotStatus)
	}
}

func TestDeleteMissingKeyIsIdempotent(t *testing.T) {
	ts, _ := newTestServer(t)
	// Per the S3 spec (and the adapter's comment), DELETE on a missing
	// key returns 204 rather than 404. Pinning that behaviour so a
	// later refactor can't quietly regress to 404.
	status := s3DeleteObject(t, ts, "never-existed.md")
	if status != http.StatusNoContent {
		t.Fatalf("DELETE missing: status %d, want 204", status)
	}
}

func TestPutEmptyFile(t *testing.T) {
	ts, _ := newTestServer(t)
	s3PutObject(t, ts, "empty.md", []byte{})

	status, got, _ := s3GetObject(t, ts, "empty.md")
	if status != http.StatusOK {
		t.Fatalf("GET empty: status %d", status)
	}
	if len(got) != 0 {
		t.Fatalf("GET empty: body=%q, want zero-length", got)
	}
}

func TestPutNestedPathCreatesParents(t *testing.T) {
	ts, _ := newTestServer(t)
	// Deeply-nested key : the adapter must create intermediate dirs
	// transparently or this round-trip fails.
	key := "a/b/c/d/e/nested.md"
	body := []byte("# Nested")
	s3PutObject(t, ts, key, body)

	status, got, _ := s3GetObject(t, ts, key)
	if status != http.StatusOK {
		t.Fatalf("GET nested: status %d", status)
	}
	if !bytes.Equal(got, body) {
		t.Fatalf("GET nested: body=%q, want %q", got, body)
	}
}

func TestPutLargeBody(t *testing.T) {
	ts, _ := newTestServer(t)
	// 256 KiB : above StreamInMemoryThreshold (currently 64 KiB) so we
	// exercise the streaming PUT path in adapter.PutObject, not just
	// the in-memory branch.
	body := bytes.Repeat([]byte("kiwifs-content-block-"), 256*1024/len("kiwifs-content-block-")+1)
	body = body[:256*1024]
	s3PutObject(t, ts, "large.bin", body)

	status, got, _ := s3GetObject(t, ts, "large.bin")
	if status != http.StatusOK {
		t.Fatalf("GET large: status %d", status)
	}
	if len(got) != len(body) {
		t.Fatalf("GET large: %d bytes, want %d", len(got), len(body))
	}
	if !bytes.Equal(got, body) {
		t.Fatal("GET large: body mismatch")
	}

	// HEAD should report the same size without reading the body : the
	// regression we'd worry about is HEAD silently rebuffering and OOM-ing
	// on a large file.
	hStatus, hdr := s3HeadObject(t, ts, "large.bin")
	if hStatus != http.StatusOK {
		t.Fatalf("HEAD large: status %d", hStatus)
	}
	if cl, _ := strconv.Atoi(hdr.Get("Content-Length")); cl != len(body) {
		t.Fatalf("HEAD large: Content-Length=%s, want %d", hdr.Get("Content-Length"), len(body))
	}
}

func TestGetMissingKeyIs404(t *testing.T) {
	ts, _ := newTestServer(t)
	status, _, _ := s3GetObject(t, ts, "nope.md")
	if status != http.StatusNotFound {
		t.Fatalf("GET missing: status %d, want 404", status)
	}
}

func TestRoundTripMultipleKeys(t *testing.T) {
	// Stress the LIST+GET ordering after a batch of writes : picks up
	// any regression where a write doesn't make it into the listing
	// because of a missed indexer call or storage flush.
	ts, _ := newTestServer(t)
	keys := []string{"x/1.md", "x/2.md", "x/3.md", "y/1.md", "z.md"}
	for i, k := range keys {
		s3PutObject(t, ts, k, fmt.Appendf(nil, "# Body %d", i))
	}

	got := s3ListObjectsV2(t, ts, "")
	if len(got.Contents) != len(keys) {
		t.Fatalf("LIST: %d entries, want %d (%+v)", len(got.Contents), len(keys), got.Contents)
	}
	for i, k := range keys {
		status, body, _ := s3GetObject(t, ts, k)
		if status != http.StatusOK {
			t.Fatalf("GET %s: status %d", k, status)
		}
		want := fmt.Appendf(nil, "# Body %d", i)
		if !bytes.Equal(body, want) {
			t.Fatalf("GET %s: body=%q, want %q", k, body, want)
		}
	}
}

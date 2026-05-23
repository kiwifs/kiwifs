package api

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func TestReadyzReportsProtocolHealth(t *testing.T) {
	s := buildTestServer(t)

	healthy := listenTCP(t)
	defer healthy.Close()
	unhealthyAddr, unhealthyPort := closedTCPAddr(t)
	healthyAddr := healthy.Addr().String()
	_, healthyPortRaw, err := net.SplitHostPort(healthyAddr)
	if err != nil {
		t.Fatalf("split healthy addr: %v", err)
	}
	healthyPort, err := strconv.Atoi(healthyPortRaw)
	if err != nil {
		t.Fatalf("parse healthy port: %v", err)
	}

	s.SetProtocolHealth([]ProtocolHealthProbe{
		NewTCPProtocolHealthProbe("s3", true, healthyAddr, healthyPort, 50*time.Millisecond),
		NewTCPProtocolHealthProbe("webdav", true, unhealthyAddr, unhealthyPort, 50*time.Millisecond),
		{Name: "nfs", Enabled: false},
	})

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("readyz status = %d, want 503; body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Status    string `json:"status"`
		Protocols map[string]struct {
			Enabled bool   `json:"enabled"`
			Healthy bool   `json:"healthy"`
			Port    int    `json:"port"`
			Error   string `json:"error"`
		} `json:"protocols"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v (body=%s)", err, rec.Body.String())
	}
	if out.Status != "protocol-unhealthy" {
		t.Fatalf("status = %q, want protocol-unhealthy", out.Status)
	}
	if got := out.Protocols["s3"]; !got.Enabled || !got.Healthy || got.Port != healthyPort {
		t.Fatalf("s3 status = %+v, want enabled healthy on port %d", got, healthyPort)
	}
	if got := out.Protocols["webdav"]; !got.Enabled || got.Healthy || got.Error == "" {
		t.Fatalf("webdav status = %+v, want enabled unhealthy with error", got)
	}
	if got := out.Protocols["nfs"]; got.Enabled || got.Healthy || got.Port != 0 {
		t.Fatalf("nfs status = %+v, want disabled", got)
	}
}

func TestReadyzReturnsOKWhenEnabledProtocolsAreHealthy(t *testing.T) {
	s := buildTestServer(t)

	healthy := listenTCP(t)
	defer healthy.Close()
	addr := healthy.Addr().String()
	_, portRaw, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("split addr: %v", err)
	}
	port, err := strconv.Atoi(portRaw)
	if err != nil {
		t.Fatalf("parse port: %v", err)
	}

	s.SetProtocolHealth([]ProtocolHealthProbe{
		NewTCPProtocolHealthProbe("s3", true, addr, port, 50*time.Millisecond),
		{Name: "webdav", Enabled: false},
		{Name: "nfs", Enabled: false},
	})

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("readyz status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Status    string `json:"status"`
		Protocols map[string]struct {
			Enabled bool `json:"enabled"`
			Healthy bool `json:"healthy"`
		} `json:"protocols"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v (body=%s)", err, rec.Body.String())
	}
	if out.Status != "ready" {
		t.Fatalf("status = %q, want ready", out.Status)
	}
	if got := out.Protocols["s3"]; !got.Enabled || !got.Healthy {
		t.Fatalf("s3 status = %+v, want enabled healthy", got)
	}
	if got := out.Protocols["webdav"]; got.Enabled || got.Healthy {
		t.Fatalf("webdav status = %+v, want disabled", got)
	}
}

func listenTCP(t *testing.T) net.Listener {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	return ln
}

func closedTCPAddr(t *testing.T) (string, int) {
	t.Helper()
	ln := listenTCP(t)
	addr := ln.Addr().String()
	if err := ln.Close(); err != nil {
		t.Fatalf("close listener: %v", err)
	}
	_, portRaw, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("split addr: %v", err)
	}
	port, err := strconv.Atoi(portRaw)
	if err != nil {
		t.Fatalf("parse port: %v", err)
	}
	return addr, port
}

func TestSwaggerRedirects(t *testing.T) {
	s := buildTestServer(t)

	// Test GET /api/docs redirects to /api/docs/index.html
	req := httptest.NewRequest(http.MethodGet, "/api/docs", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusMovedPermanently {
		t.Fatalf("GET /api/docs status = %d, want 301", rec.Code)
	}
	if loc := rec.Result().Header.Get("Location"); loc != "/api/docs/index.html" {
		t.Fatalf("GET /api/docs Location = %q, want /api/docs/index.html", loc)
	}

	// Test GET /api/docs/ redirects to /api/docs/index.html
	req2 := httptest.NewRequest(http.MethodGet, "/api/docs/", nil)
	rec2 := httptest.NewRecorder()
	s.echo.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusMovedPermanently {
		t.Fatalf("GET /api/docs/ status = %d, want 301", rec2.Code)
	}
	if loc := rec2.Result().Header.Get("Location"); loc != "/api/docs/index.html" {
		t.Fatalf("GET /api/docs/ Location = %q, want /api/docs/index.html", loc)
	}
}


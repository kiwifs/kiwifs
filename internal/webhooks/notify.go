package webhooks

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

const ExportCompletedType = "export.completed"

// ExportNotification is the JSON payload POSTed after a successful kiwifs export.
type ExportNotification struct {
	Type      string `json:"type"`
	Format    string `json:"format"`
	FileCount int    `json:"file_count"`
	Timestamp string `json:"timestamp"`
	Output    string `json:"output,omitempty"`
}

// Post sends a JSON POST to url. When secret is non-empty, standard webhook and
// X-Kiwi-Signature-256 headers are set. Returns the HTTP status code and an error
// if the request failed or the response was not 2xx.
func Post(ctx context.Context, url, secret string, payload any, client *http.Client) (statusCode int, err error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, fmt.Errorf("marshal payload: %w", err)
	}
	return postBody(ctx, url, secret, body, client)
}

func postBody(ctx context.Context, url, secret string, body []byte, client *http.Client) (statusCode int, err error) {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return 0, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	if secret != "" {
		msgID := generateMsgID()
		now := time.Now().UTC()
		req.Header.Set("webhook-id", msgID)
		req.Header.Set("webhook-timestamp", strconv.FormatInt(now.Unix(), 10))

		sig, err := signPayload(secret, msgID, now, body)
		if err != nil {
			return 0, fmt.Errorf("sign payload: %w", err)
		}
		req.Header.Set("webhook-signature", sig)
		req.Header.Set("X-Kiwi-Signature-256", bodySignature(secret, body))
	}

	resp, err := client.Do(req)
	if resp != nil {
		statusCode = resp.StatusCode
		resp.Body.Close()
	}
	if err != nil {
		return statusCode, err
	}
	if statusCode < 200 || statusCode >= 300 {
		return statusCode, fmt.Errorf("unexpected status %d", statusCode)
	}
	return statusCode, nil
}

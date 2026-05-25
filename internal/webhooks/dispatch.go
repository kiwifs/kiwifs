package webhooks

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	standardwebhooks "github.com/standard-webhooks/standard-webhooks/libraries/go"
)

type Event struct {
	Type      string `json:"type"`
	Path      string `json:"path"`
	Actor     string `json:"actor"`
	Timestamp string `json:"timestamp"`
	FromState string `json:"from_state,omitempty"`
	ToState   string `json:"to_state,omitempty"`
	Field     string `json:"field,omitempty"`
}

type Dispatcher struct {
	store       *Store
	workers     int
	maxRetries  int
	queue       chan dispatchJob
	wg          sync.WaitGroup
	stopCh      chan struct{}
	client      *http.Client
	retryDelays []time.Duration
}

type dispatchJob struct {
	webhook Webhook
	event   Event
	attempt int
}

type Config struct {
	Enabled     bool            `toml:"enabled"`
	MaxWorkers  int             `toml:"max_workers"`
	MaxRetries  int             `toml:"max_retries"`
	RetryDelays []time.Duration `toml:"-"`
}

func NewDispatcher(store *Store, cfg Config) *Dispatcher {
	workers := cfg.MaxWorkers
	if workers <= 0 {
		workers = 4
	}
	maxRetries := cfg.MaxRetries
	if maxRetries <= 0 {
		maxRetries = 5
	}
	d := &Dispatcher{
		store:       store,
		workers:     workers,
		maxRetries:  maxRetries,
		queue:       make(chan dispatchJob, 256),
		stopCh:      make(chan struct{}),
		client:      &http.Client{Timeout: 30 * time.Second},
		retryDelays: cfg.RetryDelays,
	}
	if len(d.retryDelays) == 0 {
		d.retryDelays = []time.Duration{5 * time.Second, 30 * time.Second, 2 * time.Minute, 15 * time.Minute, time.Hour}
	}
	for i := 0; i < workers; i++ {
		d.wg.Add(1)
		go d.worker()
	}
	return d
}

func (d *Dispatcher) Dispatch(ctx context.Context, event Event) {
	if d == nil {
		return
	}
	matches, err := d.store.FindMatching(ctx, event.Path, event.Type)
	if err != nil {
		log.Printf("webhooks: find matching: %v", err)
		return
	}
	for _, wh := range matches {
		secret, err := d.store.GetSecret(ctx, wh.ID)
		if err != nil {
			continue
		}
		wh.Secret = secret
		select {
		case d.queue <- dispatchJob{webhook: wh, event: event, attempt: 0}:
		default:
			log.Printf("webhooks: queue full, dropping event for %s", wh.URL)
		}
	}
}

func (d *Dispatcher) Close() {
	select {
	case <-d.stopCh:
	default:
		close(d.stopCh)
	}
	d.wg.Wait()
}

func (d *Dispatcher) worker() {
	defer d.wg.Done()
	for {
		select {
		case <-d.stopCh:
			return
		case job := <-d.queue:
			d.deliver(job)
		}
	}
}

func (d *Dispatcher) deliver(job dispatchJob) {
	payload, err := json.Marshal(job.event)
	if err != nil {
		log.Printf("webhooks: marshal event: %v", err)
		return
	}
	deliveryID := ""
	if d.store != nil {
		delivery, derr := d.store.RecordDelivery(context.Background(), Delivery{
			WebhookID: job.webhook.ID,
			EventType: job.event.Type,
			Path:      job.event.Path,
			Attempt:   job.attempt + 1,
			Status:    "pending",
		})
		if derr != nil {
			log.Printf("webhooks: record delivery: %v", derr)
		} else {
			deliveryID = delivery.ID
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	statusCode, err := postBody(ctx, job.webhook.URL, job.webhook.Secret, payload, d.client)
	if err != nil {
		errMsg := err.Error()
		d.updateDelivery(deliveryID, "failed", statusCode, errMsg)
		if job.attempt < d.maxRetries {
			delay := d.retryDelay(job.attempt)
			time.AfterFunc(delay, func() {
				job.attempt++
				select {
				case d.queue <- job:
				default:
				}
			})
		} else {
			log.Printf("webhooks: max retries exhausted for %s", job.webhook.URL)
		}
		return
	}
	d.updateDelivery(deliveryID, "delivered", statusCode, "")
}

func (d *Dispatcher) updateDelivery(id, status string, statusCode int, errMsg string) {
	if id == "" || d.store == nil {
		return
	}
	if err := d.store.UpdateDelivery(context.Background(), id, status, statusCode, errMsg); err != nil {
		log.Printf("webhooks: update delivery: %v", err)
	}
}

func (d *Dispatcher) retryDelay(attempt int) time.Duration {
	if attempt < len(d.retryDelays) {
		return d.retryDelays[attempt]
	}
	return time.Hour
}

func generateMsgID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return "msg_" + hex.EncodeToString(b)
}

func signPayload(secret, msgID string, timestamp time.Time, payload []byte) (string, error) {
	key := []byte(secret)
	if decoded, err := base64.StdEncoding.DecodeString(secret); err == nil {
		key = decoded
	}
	wh, err := standardwebhooks.NewWebhookRaw(key)
	if err != nil {
		return "", fmt.Errorf("create webhook signer: %w", err)
	}
	return wh.Sign(msgID, timestamp, payload)
}

func bodySignature(secret string, payload []byte) string {
	key := []byte(secret)
	if decoded, err := base64.StdEncoding.DecodeString(secret); err == nil {
		key = decoded
	}
	mac := hmac.New(sha256.New, key)
	mac.Write(payload)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

package webhooks

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

type Webhook struct {
	ID         string   `json:"id"`
	URL        string   `json:"url"`
	PathGlob   string   `json:"path_glob"`
	Secret     string   `json:"secret,omitempty"`
	CreatedAt  string   `json:"created_at"`
	Enabled    bool     `json:"enabled"`
	EventTypes []string `json:"event_types,omitempty"`
}

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) (*Store, error) {
	s := &Store{db: db}
	if err := s.createSchema(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) createSchema() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS webhooks (
			id           TEXT PRIMARY KEY,
			url          TEXT NOT NULL,
			path_glob    TEXT NOT NULL,
			secret       TEXT NOT NULL,
			created_at   TEXT NOT NULL,
			enabled      INTEGER NOT NULL DEFAULT 1,
			event_types  TEXT
		)
	`)
	if err != nil {
		return err
	}
	s.db.Exec(`ALTER TABLE webhooks ADD COLUMN event_types TEXT`)
	return nil
}

func (s *Store) Register(ctx context.Context, url, pathGlob string, eventTypes ...string) (*Webhook, error) {
	id := generateID()
	secret := generateSecret()

	wh := &Webhook{
		ID:         id,
		URL:        url,
		PathGlob:   pathGlob,
		Secret:     secret,
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
		Enabled:    true,
		EventTypes: eventTypes,
	}

	var etJSON *string
	if len(eventTypes) > 0 {
		data, _ := json.Marshal(eventTypes)
		s := string(data)
		etJSON = &s
	}

	_, err := s.db.ExecContext(ctx,
		`INSERT INTO webhooks(id, url, path_glob, secret, created_at, enabled, event_types) VALUES (?, ?, ?, ?, ?, 1, ?)`,
		wh.ID, wh.URL, wh.PathGlob, wh.Secret, wh.CreatedAt, etJSON,
	)
	if err != nil {
		return nil, fmt.Errorf("register webhook: %w", err)
	}
	return wh, nil
}

func (s *Store) List(ctx context.Context) ([]Webhook, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, url, path_glob, created_at, enabled, event_types FROM webhooks`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Webhook
	for rows.Next() {
		var wh Webhook
		var enabled int
		var etJSON sql.NullString
		if err := rows.Scan(&wh.ID, &wh.URL, &wh.PathGlob, &wh.CreatedAt, &enabled, &etJSON); err != nil {
			return nil, err
		}
		wh.Enabled = enabled == 1
		if etJSON.Valid && etJSON.String != "" {
			_ = json.Unmarshal([]byte(etJSON.String), &wh.EventTypes)
		}
		out = append(out, wh)
	}
	if out == nil {
		out = []Webhook{}
	}
	return out, rows.Err()
}

func (s *Store) Delete(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM webhooks WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("webhook not found: %s", id)
	}
	return nil
}

func (s *Store) FindMatching(ctx context.Context, path string, eventType ...string) ([]Webhook, error) {
	all, err := s.List(ctx)
	if err != nil {
		return nil, err
	}
	et := ""
	if len(eventType) > 0 {
		et = eventType[0]
	}
	var matched []Webhook
	for _, wh := range all {
		if !wh.Enabled {
			continue
		}
		if !matchGlob(wh.PathGlob, path) {
			continue
		}
		if et != "" && len(wh.EventTypes) > 0 {
			found := false
			for _, t := range wh.EventTypes {
				if t == et {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}
		matched = append(matched, wh)
	}
	return matched, nil
}

func (s *Store) GetSecret(ctx context.Context, id string) (string, error) {
	var secret string
	err := s.db.QueryRowContext(ctx, `SELECT secret FROM webhooks WHERE id = ?`, id).Scan(&secret)
	return secret, err
}

// RegisterWithSecret registers a webhook with a caller-provided secret.
// Used by bootstrap to auto-register config-driven [[webhook_entries]].
func (s *Store) RegisterWithSecret(ctx context.Context, url, pathGlob, secret string, eventTypes ...string) (*Webhook, error) {
	id := generateID()

	wh := &Webhook{
		ID:         id,
		URL:        url,
		PathGlob:   pathGlob,
		Secret:     secret,
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
		Enabled:    true,
		EventTypes: eventTypes,
	}

	var etJSON *string
	if len(eventTypes) > 0 {
		data, _ := json.Marshal(eventTypes)
		s := string(data)
		etJSON = &s
	}

	_, err := s.db.ExecContext(ctx,
		`INSERT INTO webhooks(id, url, path_glob, secret, created_at, enabled, event_types) VALUES (?, ?, ?, ?, ?, 1, ?)`,
		wh.ID, wh.URL, wh.PathGlob, wh.Secret, wh.CreatedAt, etJSON,
	)
	if err != nil {
		return nil, fmt.Errorf("register webhook: %w", err)
	}
	return wh, nil
}

// FindByURL checks if a webhook with the given URL already exists.
func (s *Store) FindByURL(ctx context.Context, url string) (*Webhook, error) {
	var wh Webhook
	var enabled int
	var etJSON sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT id, url, path_glob, created_at, enabled, event_types FROM webhooks WHERE url = ?`, url,
	).Scan(&wh.ID, &wh.URL, &wh.PathGlob, &wh.CreatedAt, &enabled, &etJSON)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	wh.Enabled = enabled == 1
	if etJSON.Valid && etJSON.String != "" {
		_ = json.Unmarshal([]byte(etJSON.String), &wh.EventTypes)
	}
	return &wh, nil
}

func generateID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return "wh_" + hex.EncodeToString(b)
}

func generateSecret() string {
	b := make([]byte, 32)
	rand.Read(b)
	return "whsec_" + hex.EncodeToString(b)
}

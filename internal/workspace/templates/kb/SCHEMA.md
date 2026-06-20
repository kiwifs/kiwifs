# Knowledge Base Schema

## Article Types

All articles require these base fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | ✅ | Human-readable article title |
| `type` | enum | ✅ | `how-to`, `troubleshooting`, `faq`, `reference` |
| `owner` | string | ✅ | Person responsible for accuracy |
| `status` | enum | ✅ | `draft`, `review`, `verified`, `stale`, `archived` |
| `tags` | string[] | ✅ | Category and topic tags |
| `verified_at` | date | ❌ | Date of last verification (null if never verified) |
| `review_interval` | integer | ✅ | Days before next review is due (default: 90) |

### Type-specific fields

**how-to:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `estimated_time` | string | ❌ | Time to complete (e.g., "5 minutes") |
| `difficulty` | enum | ❌ | `beginner`, `intermediate`, `advanced` |

**troubleshooting:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `severity` | enum | ❌ | `low`, `medium`, `high`, `critical` |
| `affected_versions` | string[] | ❌ | Versions where this issue applies |

**faq:**

No additional fields. Keep answers concise (< 3 paragraphs).

**reference:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `api_version` | string | ❌ | API version this reference covers |

## Verification Workflow

States: `draft` → `review` → `verified` → `stale` → `archived`

- Articles start as `draft`
- Authors set `review` when ready for verification
- Reviewers set `verified` and update `verified_at`
- Janitor sets `stale` when `DAYS_AGO(verified_at) > review_interval`
- Owners re-verify or set `archived` for outdated content

# CMS Schema

## Content Types

### blog-post

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | ✅ | Post title |
| `slug` | string | ✅ | URL-safe identifier |
| `type` | `"blog-post"` | ✅ | Content type |
| `author` | wiki-link | ✅ | Link to author profile |
| `category` | string | ✅ | Primary category |
| `tags` | string[] | ✅ | Topic tags |
| `published` | boolean | ✅ | Whether publicly visible |
| `published_at` | date/null | ✅ | Publication date (ISO) |
| `meta_title` | string | ❌ | SEO title (< 60 chars) |
| `meta_description` | string | ❌ | SEO description (< 160 chars) |
| `featured` | boolean | ❌ | Pin to top of listings |

### doc

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | ✅ | Document title |
| `slug` | string | ✅ | URL-safe identifier |
| `type` | `"doc"` | ✅ | Content type |
| `author` | wiki-link | ❌ | Link to author |
| `tags` | string[] | ✅ | Topic tags |
| `published` | boolean | ✅ | Whether publicly visible |
| `published_at` | date/null | ✅ | Publication date |
| `meta_title` | string | ❌ | SEO title |
| `meta_description` | string | ❌ | SEO description |

### page

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | ✅ | Page title |
| `slug` | string | ✅ | URL-safe identifier |
| `type` | `"page"` | ✅ | Content type |
| `tags` | string[] | ❌ | Topic tags |
| `published` | boolean | ✅ | Whether publicly visible |
| `published_at` | date/null | ✅ | Publication date |
| `meta_title` | string | ❌ | SEO title |
| `meta_description` | string | ❌ | SEO description |

### author

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | ✅ | Display name |
| `type` | `"author"` | ✅ | Content type |
| `name` | string | ✅ | Full name |
| `role` | string | ❌ | Job title / role |
| `bio` | string | ❌ | Short biography |
| `avatar` | string/null | ❌ | Avatar image URL |
| `social` | object | ❌ | Social links (twitter, github, website) |

## Editorial Workflow

States: `draft` → `review` → `scheduled` → `published` → `archived`

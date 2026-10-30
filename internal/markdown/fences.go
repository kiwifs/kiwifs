package markdown

import (
	"embed"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"unicode"

	yaml "go.yaml.in/yaml/v3"
)

// fences.json is generated from the UI's fence specs by
// `ui/scripts/emit-fence-schemas.mjs`. It is the one description of every
// widget fence: the linter below, the kiwi_widget_reference MCP tool, the
// REST mirror, and docs/WIDGETS.md all read it, so a key documented once is
// documented everywhere. CI fails if it drifts from the specs.
//
//go:embed fenceschemas/fences.json
var fenceSchemaFS embed.FS

// MaxFenceBodyBytes caps a single widget fence. Same reasoning as
// MaxDataBlockBytes: yaml.v3 guards against aliasing on its own, but a size
// cap keeps a pathological page from dominating a lint or index pass.
const MaxFenceBodyBytes = 256 * 1024

// maxFenceIndexText bounds the labels and cell values harvested from one
// fence for the search index. Captions and step notes are authored prose and
// are kept whole; the data is only there so a search for a node label finds
// the page, and a 2,000-cell grid must not drown the rest of it.
const maxFenceIndexText = 500

// FenceAttribute describes one key of a widget fence.
type FenceAttribute struct {
	Type        string `json:"type"`
	Required    bool   `json:"required,omitempty"`
	Items       string `json:"items,omitempty"`
	Matches     []any  `json:"matches,omitempty"`
	Pattern     string `json:"pattern,omitempty"`
	Description string `json:"description,omitempty"`
	// Alias is an older spelling the UI folds into this key before the view
	// sees it (`rowArrows` for `arrowsBetweenRows`).
	Alias string `json:"alias,omitempty"`
	// Steppable is a pointer so "absent" reads as true, matching the emitter,
	// which only writes the field when a key is pinned.
	Steppable *bool `json:"steppable,omitempty"`
}

// CanStep reports whether a step patch may set this key.
func (a FenceAttribute) CanStep() bool {
	return a.Steppable == nil || *a.Steppable
}

// FenceSpec is one widget fence: its language tag, its keys, and an example.
type FenceSpec struct {
	Lang    string   `json:"lang"`
	Aliases []string `json:"aliases"`
	// StrictAliases are the spellings that always claim their block and
	// report every error: `kiwi-array`, `widget:array`. Every other tag,
	// including Lang itself, is sniffed. Older catalogues omit the field;
	// the `kiwi-`/`widget:` prefix rule covers them.
	StrictAliases []string `json:"strictAliases,omitempty"`
	// Reclaims names reserved top-level keys this fence uses as ordinary
	// props, like `frames` for a sequence diagram's alt/loop boxes.
	Reclaims []string `json:"reclaims,omitempty"`
	// RequireSteps marks a fence that is only meaningful stepped, like
	// `kiwi-steps`: no steps (or an empty list) is an error, not a still.
	RequireSteps bool     `json:"requireSteps,omitempty"`
	Description  string   `json:"description"`
	Required     []string `json:"required"`
	// RequireOneOf names keys of which at least one has to be present. A
	// table needs its rows from somewhere — `rows:` or `fromData:` — and no
	// single key can be marked required to say that.
	RequireOneOf []string                  `json:"requireOneOf,omitempty"`
	Example      string                    `json:"example"`
	Attributes   map[string]FenceAttribute `json:"attributes"`

	strict    map[string]bool
	reclaimed map[string]bool
	aliasTo   map[string]string
}

// FenceCatalogue is the whole generated file.
type FenceCatalogue struct {
	Version          int         `json:"version"`
	ReservedTopLevel []string    `json:"reservedTopLevel"`
	ReservedStep     []string    `json:"reservedStep"`
	Fences           []FenceSpec `json:"fences"`
}

var (
	catalogueOnce sync.Once
	catalogue     FenceCatalogue
	catalogueErr  error
	byLang        map[string]*FenceSpec
	byLangFold    map[string]*FenceSpec
	reservedTop   map[string]bool
	reservedStep  map[string]bool
)

func loadCatalogue() {
	catalogueOnce.Do(func() {
		data, err := fenceSchemaFS.ReadFile("fenceschemas/fences.json")
		if err != nil {
			catalogueErr = fmt.Errorf("read fence schemas: %w", err)
			return
		}
		if err := json.Unmarshal(data, &catalogue); err != nil {
			catalogueErr = fmt.Errorf("parse fence schemas: %w", err)
			return
		}
		byLang = make(map[string]*FenceSpec, len(catalogue.Fences)*3)
		byLangFold = make(map[string]*FenceSpec, len(catalogue.Fences)*3)
		for i := range catalogue.Fences {
			spec := &catalogue.Fences[i]
			indexSpec(spec)
			for _, tag := range append([]string{spec.Lang}, spec.Aliases...) {
				byLang[tag] = spec
				if _, taken := byLangFold[strings.ToLower(tag)]; !taken {
					byLangFold[strings.ToLower(tag)] = spec
				}
			}
			for _, tag := range spec.StrictAliases {
				if _, ok := byLang[tag]; !ok {
					byLang[tag] = spec
				}
				if _, ok := byLangFold[strings.ToLower(tag)]; !ok {
					byLangFold[strings.ToLower(tag)] = spec
				}
			}
		}
		reservedTop = make(map[string]bool, len(catalogue.ReservedTopLevel))
		for _, k := range catalogue.ReservedTopLevel {
			reservedTop[k] = true
		}
		reservedStep = make(map[string]bool, len(catalogue.ReservedStep))
		for _, k := range catalogue.ReservedStep {
			reservedStep[k] = true
		}
	})
}

func indexSpec(spec *FenceSpec) {
	spec.strict = make(map[string]bool, len(spec.StrictAliases))
	for _, tag := range spec.StrictAliases {
		spec.strict[strings.ToLower(tag)] = true
	}
	spec.reclaimed = make(map[string]bool, len(spec.Reclaims))
	for _, key := range spec.Reclaims {
		spec.reclaimed[key] = true
	}
	// Catalogues emitted before `reclaims` existed: a fence declaring its own
	// `frames` attribute has always meant boxes, not one prop set per step.
	if spec.Reclaims == nil {
		if _, ok := spec.Attributes["frames"]; ok {
			spec.reclaimed["frames"] = true
		}
	}
	spec.aliasTo = map[string]string{}
	for name, attr := range spec.Attributes {
		if attr.Alias != "" {
			spec.aliasTo[attr.Alias] = name
		}
	}
}

// WidgetFences returns every fence in the catalogue, ordered by language tag.
func WidgetFences() ([]FenceSpec, error) {
	loadCatalogue()
	if catalogueErr != nil {
		return nil, catalogueErr
	}
	return catalogue.Fences, nil
}

// WidgetFence looks up one fence by its tag or any alias, ignoring case.
func WidgetFence(lang string) (*FenceSpec, bool) {
	loadCatalogue()
	if catalogueErr != nil {
		return nil, false
	}
	lang = strings.TrimSpace(lang)
	if spec, ok := byLang[lang]; ok {
		return spec, true
	}
	spec, ok := byLangFold[strings.ToLower(lang)]
	return spec, ok
}

// WidgetFenceReserved returns the reserved key sets, for callers rendering a
// reference page.
func WidgetFenceReserved() (topLevel, step []string) {
	loadCatalogue()
	if catalogueErr != nil {
		return nil, nil
	}
	return catalogue.ReservedTopLevel, catalogue.ReservedStep
}

func (s *FenceSpec) reclaims(key string) bool {
	return s.reclaimed[key]
}

// attribute resolves a key as written, or its alias, to the attribute name.
func (s *FenceSpec) attribute(key string) (string, FenceAttribute, bool) {
	if attr, ok := s.Attributes[key]; ok {
		return key, attr, true
	}
	if name, ok := s.aliasTo[key]; ok {
		return name, s.Attributes[name], true
	}
	return "", FenceAttribute{}, false
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

// FenceOptions mirrors a workspace's `[ui] typed_fences` and
// `typed_fence_tags`. The zero value is the default: every bare tag may
// claim a block. Strict spellings (`kiwi-…`, `widget:…`) ignore it.
type FenceOptions struct {
	// DisableBare stops sniffed tags (```array, ```tree, …) from being
	// treated as widgets at all.
	DisableBare bool
	// BareTags, when non-nil, lists the only sniffed tags that may claim a
	// block. A fence's canonical tag also admits its other bare aliases.
	BareTags []string
}

var defaultFenceOptions atomic.Pointer[FenceOptions]

// SetDefaultFenceOptions sets what LintMarkdown, IndexableContent and
// StripWidgetFences use. It is process-wide, so only a single-workspace
// process (a CLI run) should call it; a server hosting several spaces passes
// options explicitly through the WithOptions variants.
func SetDefaultFenceOptions(opts FenceOptions) {
	defaultFenceOptions.Store(&opts)
}

func currentFenceOptions() FenceOptions {
	if p := defaultFenceOptions.Load(); p != nil {
		return *p
	}
	return FenceOptions{}
}

func (o FenceOptions) allowsBare(spec *FenceSpec, lang string) bool {
	if o.DisableBare {
		return false
	}
	if o.BareTags == nil {
		return true
	}
	for _, tag := range o.BareTags {
		if strings.EqualFold(tag, lang) || strings.EqualFold(tag, spec.Lang) {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Sniffing
// ---------------------------------------------------------------------------

// isStrictTag reports whether this spelling asked to be a widget no matter
// what the body holds. Only the explicit `kiwi-…` / `widget:…` forms do; a
// bare tag or a friendly alias (```steps, ```grid, ```gantt) has to coexist
// with vaults that already use those words for code blocks.
func isStrictTag(spec *FenceSpec, lang string) bool {
	l := strings.ToLower(strings.TrimSpace(lang))
	if spec.strict[l] {
		return true
	}
	return strings.HasPrefix(l, "kiwi-") || strings.HasPrefix(l, "widget:")
}

// sniffBody mirrors the UI: a sniffed tag claims a body that is a mapping
// carrying one of the spec's required keys — at the top, under `props:`, or
// in the first step or frame, where a walkthrough may introduce it.
func sniffBody(spec *FenceSpec, body map[string]any) bool {
	if body == nil {
		return false
	}
	if len(spec.Required) == 0 {
		return true
	}
	candidates := []map[string]any{body}
	if props, ok := asMap(body["props"]); ok {
		candidates = append(candidates, props)
	}
	lists := []string{"steps"}
	if !spec.reclaims("frames") {
		lists = append(lists, "frames")
	}
	for _, list := range lists {
		if items, ok := body[list].([]any); ok && len(items) > 0 {
			if first, ok := asMap(items[0]); ok {
				candidates = append(candidates, first)
			}
		}
	}
	for _, key := range spec.Required {
		names := []string{key}
		if attr, ok := spec.Attributes[key]; ok && attr.Alias != "" {
			names = append(names, attr.Alias)
		}
		for _, m := range candidates {
			for _, name := range names {
				if _, ok := m[name]; ok {
					return true
				}
			}
		}
	}
	return false
}

// looksIntended reports whether a body that failed to parse was nonetheless
// written as this widget's YAML: one of its required keys appears at the start
// of a line, followed by a colon.
func looksIntended(spec *FenceSpec, lines []string) bool {
	for _, key := range spec.Required {
		needle := key + ":"
		for _, line := range lines {
			if strings.HasPrefix(strings.TrimLeft(line, " \t-"), needle) {
				return true
			}
		}
	}
	return false
}

// parsedFence is a fence body decoded once, for both the claim decision and
// the checks that follow it.
type parsedFence struct {
	spec   *FenceSpec
	lang   string
	strict bool
	// root is the top YAML node, kept for its line numbers.
	root     *yaml.Node
	body     map[string]any
	err      error
	errLine  int // 1-based within the body, 0 when the error names no line
	oversize bool
}

func parseWidgetFence(spec *FenceSpec, lang, source string) parsedFence {
	p := parsedFence{spec: spec, lang: lang, strict: isStrictTag(spec, lang)}
	if len(source) > MaxFenceBodyBytes {
		p.oversize = true
		return p
	}
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(source), &doc); err != nil {
		p.err, p.errLine = err, yamlErrorLine(err)
		return p
	}
	root := &doc
	if root.Kind == yaml.DocumentNode {
		if len(root.Content) == 0 {
			return p
		}
		root = root.Content[0]
	}
	p.root = root
	var raw any
	if err := root.Decode(&raw); err != nil {
		p.err, p.errLine = err, yamlErrorLine(err)
		return p
	}
	p.body, _ = asMap(raw)
	return p
}

// claims reports whether the block renders as this widget in the UI.
func (p parsedFence) claims(opts FenceOptions) bool {
	if p.strict {
		return true
	}
	if !opts.allowsBare(p.spec, p.lang) {
		return false
	}
	return sniffBody(p.spec, p.body)
}

var yamlLineRe = regexp.MustCompile(`\bline (\d+)\b`)

func yamlErrorLine(err error) int {
	m := yamlLineRe.FindStringSubmatch(err.Error())
	if m == nil {
		return 0
	}
	n, _ := strconv.Atoi(m[1])
	return n
}

// asMap accepts both shapes yaml.v3 produces for a mapping. A key that is not
// a string (`{0: [0]}`, keyed by node index) arrives as map[any]any, where
// js-yaml would have handed the UI an object with string keys.
func asMap(v any) (map[string]any, bool) {
	switch m := v.(type) {
	case map[string]any:
		return m, true
	case map[any]any:
		out := make(map[string]any, len(m))
		for k, val := range m {
			out[fmt.Sprint(k)] = val
		}
		return out, true
	}
	return nil, false
}

// ---------------------------------------------------------------------------
// Fence scanning
// ---------------------------------------------------------------------------

// fenceSpan is one fenced block of any language. Every opening fence is
// tracked, so a ```array shown inside a ````markdown or ~~~ example is body
// text of that block, not a widget.
type fenceSpan struct {
	start, end int // line indices of the fences; end is -1 when unclosed
	indent     string
	lang, meta string
	// body is dedented by the opening fence's indentation, so a fence inside
	// a list item parses like one at the margin.
	body []string
}

func scanFenceSpans(lines []string) []fenceSpan {
	var out []fenceSpan
	for i := 0; i < len(lines); i++ {
		trimmed := strings.TrimSpace(lines[i])
		if !isOpeningFence(trimmed) {
			continue
		}
		marker := extractFenceMarker(trimmed)
		span := fenceSpan{start: i, end: -1, indent: leadingWhitespace(lines[i])}
		span.lang, span.meta = splitFenceInfo(trimmed)
		for j := i + 1; j < len(lines); j++ {
			if isClosingFence(strings.TrimSpace(lines[j]), marker) {
				span.end = j
				break
			}
			span.body = append(span.body, dedent(lines[j], len(span.indent)))
		}
		out = append(out, span)
		if span.end < 0 {
			break
		}
		i = span.end
	}
	return out
}

func splitFenceInfo(trimmed string) (lang, meta string) {
	info := strings.TrimLeft(trimmed, "`~")
	info = strings.TrimSpace(info)
	if idx := strings.IndexFunc(info, unicode.IsSpace); idx >= 0 {
		return info[:idx], strings.TrimSpace(info[idx:])
	}
	return info, ""
}

func leadingWhitespace(line string) string {
	return line[:len(line)-len(strings.TrimLeft(line, " \t"))]
}

func dedent(line string, n int) string {
	i := 0
	for i < n && i < len(line) && (line[i] == ' ' || line[i] == '\t') {
		i++
	}
	return line[i:]
}

var quotedMetaRe = regexp.MustCompile(`(\w+)=(?:"([^"]*)"|'([^']*)')`)

// parseFenceMeta reads `key=value` pairs from the opening line after the
// tag, the same way the UI's parseFenceMeta does: quoted values first, so a
// caption with spaces survives, then bare tokens.
func parseFenceMeta(meta string) map[string]string {
	out := map[string]string{}
	if meta == "" {
		return out
	}
	rest := quotedMetaRe.ReplaceAllStringFunc(meta, func(match string) string {
		m := quotedMetaRe.FindStringSubmatch(match)
		out[m[1]] = m[2] + m[3]
		return " "
	})
	for _, token := range strings.Fields(rest) {
		if key, value, ok := strings.Cut(token, "="); ok {
			out[key] = value
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// Rule 11: fence-widget-invalid
// ---------------------------------------------------------------------------

type widgetFenceBlock struct {
	lang  string
	spec  *FenceSpec
	line  int // 1-based line of the opening fence
	lines []string
}

// collectWidgetFences walks the body for closed fences whose tag names a widget.
func collectWidgetFences(body []byte, lineOffset int) []widgetFenceBlock {
	var out []widgetFenceBlock
	for _, span := range scanFenceSpans(strings.Split(string(body), "\n")) {
		if span.end < 0 {
			continue
		}
		spec, ok := WidgetFence(span.lang)
		if !ok {
			continue
		}
		out = append(out, widgetFenceBlock{
			lang:  span.lang,
			spec:  spec,
			line:  span.start + 1 + lineOffset,
			lines: span.body,
		})
	}
	return out
}

func lintWidgetFences(body []byte, lineOffset int, opts FenceOptions) []LintIssue {
	loadCatalogue()
	if catalogueErr != nil {
		return nil
	}
	var issues []LintIssue
	for _, block := range collectWidgetFences(body, lineOffset) {
		issues = append(issues, lintWidgetFence(block, opts)...)
	}
	return issues
}

func lintWidgetFence(block widgetFenceBlock, opts FenceOptions) []LintIssue {
	spec := block.spec
	strict := isStrictTag(spec, block.lang)
	// A workspace that turned bare tags off sees them as code blocks, so
	// there is nothing to say about one.
	if !strict && !opts.allowsBare(spec, block.lang) {
		return nil
	}
	issue := func(rel int, message, severity string) []LintIssue {
		return []LintIssue{{
			Rule:     "fence-widget-invalid",
			Line:     block.line + rel,
			Message:  fmt.Sprintf("%s fence: %s", block.lang, message),
			Severity: severity,
		}}
	}

	p := parseWidgetFence(spec, block.lang, strings.Join(block.lines, "\n"))
	if p.oversize {
		if !strict && !looksIntended(spec, block.lines) {
			return nil
		}
		return issue(0, fmt.Sprintf("body exceeds %d bytes", MaxFenceBodyBytes), "warning")
	}
	if p.err != nil {
		// An explicit kiwi-/widget: spelling asked to be checked, so broken
		// YAML is an error. A bare tag only gets a warning, and only when the
		// body was plainly meant as this widget's YAML — a ```table holding a
		// pipe table is a code block, and saying otherwise is noise.
		severity := "error"
		if !strict {
			if !looksIntended(spec, block.lines) {
				return nil
			}
			severity = "warning"
		}
		return issue(p.errLine, "YAML parse error: "+firstLine(p.err.Error()), severity)
	}
	if !p.claims(opts) {
		// Renders as a plain code block in the UI; nothing to check.
		return nil
	}
	if p.body == nil {
		return issue(0, "expected a YAML mapping of widget properties", "error")
	}
	return validateWidgetBody(block, p)
}

func validateWidgetBody(block widgetFenceBlock, p parsedFence) []LintIssue {
	spec := p.spec
	lines := indexFenceLines(p.root)
	var issues []LintIssue
	add := func(rel int, message, severity string) {
		issues = append(issues, LintIssue{
			Rule:     "fence-widget-invalid",
			Line:     block.line + rel,
			Message:  fmt.Sprintf("%s fence: %s", block.lang, message),
			Severity: severity,
		})
	}

	known := make([]string, 0, len(spec.Attributes))
	for key := range spec.Attributes {
		known = append(known, key)
	}
	sort.Strings(known)

	base := map[string]any{}
	for _, key := range sortedKeys(p.body) {
		if reservedTop[key] && !spec.reclaims(key) {
			continue
		}
		value := p.body[key]
		name, attr, ok := spec.attribute(key)
		if !ok {
			add(lines.top[key], unknownKeyMessage(key, known), "warning")
			continue
		}
		base[name] = value
		if msg := checkType(key, attr, value); msg != "" {
			add(lines.top[key], msg, "error")
		}
	}
	// `props:` carries anything whose name collides with a reserved key, and
	// reaches the view whether or not the schema lists it.
	if escaped, ok := asMap(p.body["props"]); ok && !spec.reclaims("props") {
		for _, key := range sortedKeys(escaped) {
			name, attr, ok := spec.attribute(key)
			if !ok {
				continue
			}
			value := escaped[key]
			base[name] = value
			if msg := checkType(key, attr, value); msg != "" {
				add(lines.propLine(key), msg, "error")
			}
		}
	}

	listKey := ""
	var list []any
	if steps, ok := p.body["steps"].([]any); ok {
		listKey, list = "steps", steps
	}
	if frames, ok := p.body["frames"].([]any); ok && !spec.reclaims("frames") {
		if list != nil {
			add(lines.top["frames"], "a fence uses either steps or frames, not both; frames ignored", "warning")
		} else {
			listKey, list = "frames", frames
		}
	}
	if spec.RequireSteps && len(list) == 0 {
		rel := 0
		if _, present := p.body["steps"]; present {
			rel = lines.top["steps"]
		}
		add(rel, "steps must be a non-empty list", "error")
	}

	// Required keys hold on whatever the first frame shows: the base plus
	// step one, which may legitimately be where `value:` first appears.
	// Later steps are patches and do not count.
	first := make(map[string]any, len(base))
	for k, v := range base {
		first[k] = v
	}
	for i, rawStep := range list {
		if rawStep == nil {
			continue
		}
		if _, isString := rawStep.(string); isString {
			continue // a bare note over unchanged props
		}
		patch, ok := asMap(rawStep)
		if !ok {
			add(lines.item(listKey, i, ""), fmt.Sprintf("%s[%d] must be a mapping or a string", listKey, i), "error")
			continue
		}
		for _, key := range sortedKeys(patch) {
			if reservedStep[key] && !spec.reclaims(key) {
				continue
			}
			value := patch[key]
			at := lines.item(listKey, i, key)
			name, attr, ok := spec.attribute(key)
			if !ok {
				add(at, fmt.Sprintf("%s[%d]: %s", listKey, i, unknownKeyMessage(key, known)), "warning")
				continue
			}
			if !attr.CanStep() {
				add(at, fmt.Sprintf("%s[%d]: %q cannot change between steps", listKey, i, key), "error")
				continue
			}
			if msg := checkType(key, attr, value); msg != "" {
				add(at, fmt.Sprintf("%s[%d]: %s", listKey, i, msg), "error")
			}
			if i == 0 {
				first[name] = value
			}
		}
	}

	for _, key := range known {
		if !spec.Attributes[key].Required {
			continue
		}
		if _, ok := first[key]; !ok {
			add(lines.top[key], fmt.Sprintf("missing required key %q", key), "error")
		}
	}
	if len(spec.RequireOneOf) > 0 {
		satisfied := false
		for _, key := range spec.RequireOneOf {
			if _, ok := first[key]; ok {
				satisfied = true
				break
			}
		}
		if !satisfied {
			quoted := make([]string, len(spec.RequireOneOf))
			for i, key := range spec.RequireOneOf {
				quoted[i] = fmt.Sprintf("%q", key)
			}
			add(lines.top[spec.RequireOneOf[0]], fmt.Sprintf("needs one of %s", strings.Join(quoted, ", ")), "error")
		}
	}

	sort.SliceStable(issues, func(i, j int) bool { return issues[i].Line < issues[j].Line })
	return issues
}

// fenceLines maps keys to their 1-based line within the fence body, read
// once from the YAML node tree so an issue in steps[3] points into step 3
// rather than at the first line anywhere that happens to share the key.
type fenceLines struct {
	top   map[string]int
	props map[string]int
	lists map[string][]itemLines
}

type itemLines struct {
	line int
	keys map[string]int
}

func indexFenceLines(root *yaml.Node) fenceLines {
	out := fenceLines{top: map[string]int{}, props: map[string]int{}, lists: map[string][]itemLines{}}
	root = resolveAlias(root)
	if root == nil || root.Kind != yaml.MappingNode {
		return out
	}
	for i := 0; i+1 < len(root.Content); i += 2 {
		key, value := root.Content[i], resolveAlias(root.Content[i+1])
		out.top[key.Value] = key.Line
		switch key.Value {
		case "props":
			out.props = mappingKeyLines(value)
		case "steps", "frames":
			if value == nil || value.Kind != yaml.SequenceNode {
				continue
			}
			items := make([]itemLines, len(value.Content))
			for j, item := range value.Content {
				item = resolveAlias(item)
				items[j] = itemLines{line: item.Line, keys: mappingKeyLines(item)}
			}
			out.lists[key.Value] = items
		}
	}
	return out
}

func resolveAlias(n *yaml.Node) *yaml.Node {
	for n != nil && n.Kind == yaml.AliasNode {
		n = n.Alias
	}
	return n
}

func mappingKeyLines(n *yaml.Node) map[string]int {
	out := map[string]int{}
	if n == nil || n.Kind != yaml.MappingNode {
		return out
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		out[n.Content[i].Value] = n.Content[i].Line
	}
	return out
}

func (l fenceLines) propLine(key string) int {
	if n, ok := l.props[key]; ok {
		return n
	}
	return l.top["props"]
}

func (l fenceLines) item(list string, i int, key string) int {
	items := l.lists[list]
	if i < len(items) {
		if n, ok := items[i].keys[key]; ok && key != "" {
			return n
		}
		if items[i].line > 0 {
			return items[i].line
		}
	}
	return l.top[list]
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

var patternCache sync.Map // pattern string -> *regexp.Regexp, or nil when it does not compile

func compiledPattern(pattern string) *regexp.Regexp {
	if cached, ok := patternCache.Load(pattern); ok {
		re, _ := cached.(*regexp.Regexp)
		return re
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		// A JS-only construct; the UI still checks it.
		patternCache.Store(pattern, (*regexp.Regexp)(nil))
		return nil
	}
	patternCache.Store(pattern, re)
	return re
}

func checkType(key string, attr FenceAttribute, value any) string {
	if value == nil {
		return ""
	}
	want := strings.Split(attr.Type, "|")
	got := yamlTypeName(value)
	if !contains(want, "any") && !contains(want, got) {
		return fmt.Sprintf("%q must be %s, got %s", key, strings.Join(want, " or "), got)
	}
	if attr.Items != "" {
		if list, ok := value.([]any); ok {
			itemWant := strings.Split(attr.Items, "|")
			for i, item := range list {
				if item == nil || contains(itemWant, "any") {
					continue
				}
				if itemGot := yamlTypeName(item); !contains(itemWant, itemGot) {
					return fmt.Sprintf("%q[%d] must be %s, got %s", key, i, attr.Items, itemGot)
				}
			}
		}
	}
	if len(attr.Matches) > 0 {
		for _, allowed := range attr.Matches {
			if fmt.Sprint(allowed) == fmt.Sprint(value) {
				return ""
			}
		}
		names := make([]string, len(attr.Matches))
		for i, a := range attr.Matches {
			names[i] = fmt.Sprintf("%q", fmt.Sprint(a))
		}
		return fmt.Sprintf("%q must be one of %s", key, strings.Join(names, ", "))
	}
	if attr.Pattern != "" {
		if s, ok := value.(string); ok {
			if re := compiledPattern(attr.Pattern); re != nil && !re.MatchString(s) {
				return fmt.Sprintf("%q must match /%s/", key, attr.Pattern)
			}
		}
	}
	return ""
}

func yamlTypeName(value any) string {
	switch value.(type) {
	case string:
		return "string"
	case bool:
		return "boolean"
	case int, int64, uint64, float64:
		return "number"
	case []any:
		return "array"
	// `activeKeys: {0: [0]}` is a perfectly ordinary mapping keyed by node
	// index. yaml.v3 hands those back as map[any]any, where js-yaml gives an
	// object with string keys — so without this the Go linter rejects a fence
	// the UI renders happily.
	case map[string]any, map[any]any:
		return "object"
	default:
		return "any"
	}
}

func contains(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

// unknownKeyMessage names the nearest known key, which is what turns a typo
// from a silent no-op into a one-line fix.
func unknownKeyMessage(key string, known []string) string {
	best, bestScore := "", 1<<30
	for _, candidate := range known {
		if d := editDistance(strings.ToLower(key), strings.ToLower(candidate)); d < bestScore {
			best, bestScore = candidate, d
		}
	}
	budget := len(key) / 4
	if budget < 1 {
		budget = 1
	}
	if best != "" && bestScore <= budget {
		return fmt.Sprintf("unknown key %q — did you mean %q?", key, best)
	}
	return fmt.Sprintf("unknown key %q", key)
}

func editDistance(a, b string) int {
	ar, br := []rune(a), []rune(b)
	if len(ar) == 0 {
		return len(br)
	}
	if len(br) == 0 {
		return len(ar)
	}
	prev := make([]int, len(br)+1)
	for j := range prev {
		prev[j] = j
	}
	row := make([]int, len(br)+1)
	for i := 1; i <= len(ar); i++ {
		row[0] = i
		for j := 1; j <= len(br); j++ {
			cost := 1
			if ar[i-1] == br[j-1] {
				cost = 0
			}
			row[j] = min3(prev[j]+1, row[j-1]+1, prev[j-1]+cost)
		}
		copy(prev, row)
	}
	return prev[len(br)]
}

func min3(a, b, c int) int {
	if b < a {
		a = b
	}
	if c < a {
		a = c
	}
	return a
}

func firstLine(s string) string {
	if idx := strings.IndexByte(s, '\n'); idx >= 0 {
		return s[:idx]
	}
	return s
}

// ---------------------------------------------------------------------------
// Degradation outside the UI
// ---------------------------------------------------------------------------

// WidgetFenceClaims reports whether this body really belongs to the widget
// its language tag names. A bare ```tree holding a directory listing does
// not, and must pass through every pass untouched.
func WidgetFenceClaims(lang, source string) bool {
	spec, ok := WidgetFence(lang)
	if !ok {
		return false
	}
	return parseWidgetFence(spec, lang, source).claims(currentFenceOptions())
}

// WidgetFenceBlock is one claimed widget fence, reduced to what a reader gets
// without the UI. StripWidgetFences hands one to its renderer.
type WidgetFenceBlock struct {
	// Lang is the tag as written; Spec.Lang is the canonical one.
	Lang string
	Spec *FenceSpec
	// Meta is the opening line after the tag (`id=a caption="…"`).
	Meta string
	// Source is the body, dedented to the fence's own margin.
	Source string
	// Title and Caption come from the opening line when set there, which is
	// also what the UI shows, and from the body otherwise.
	Title   string
	Caption string
	Notes   []string
	Code    string
	// Text is short string data — node labels, cell values — capped at
	// maxFenceIndexText characters once joined with spaces.
	Text []string
}

// Prose is the title, caption and step notes, one per line, then the code
// listing when withCode is set. Everything else is coordinates.
func (b WidgetFenceBlock) Prose(withCode bool) string {
	var parts []string
	for _, s := range []string{b.Title, b.Caption} {
		if s != "" {
			parts = append(parts, s)
		}
	}
	parts = append(parts, b.Notes...)
	if withCode && b.Code != "" {
		parts = append(parts, b.Code)
	}
	return strings.Join(parts, "\n")
}

// Label names the widget for a reader who has nothing else: "array widget".
func (b WidgetFenceBlock) Label() string {
	lang := b.Lang
	if b.Spec != nil {
		lang = b.Spec.Lang
	}
	return strings.TrimPrefix(lang, "kiwi-") + " widget"
}

func summarizeFence(spec *FenceSpec, lang, meta, source string, body map[string]any) WidgetFenceBlock {
	block := WidgetFenceBlock{Lang: lang, Spec: spec, Meta: meta, Source: source}
	attrs := parseFenceMeta(meta)
	block.Title = firstNonEmpty(attrs["title"], scalarString(body["title"]))
	block.Caption = firstNonEmpty(attrs["caption"], scalarString(body["caption"]))

	lists := []string{"steps"}
	if _, hasSteps := body["steps"]; !hasSteps && !spec.reclaims("frames") {
		lists = append(lists, "frames")
	}
	for _, list := range lists {
		items, _ := body[list].([]any)
		for _, raw := range items {
			if s, ok := raw.(string); ok {
				if s = strings.TrimSpace(s); s != "" {
					block.Notes = append(block.Notes, s)
				}
				continue
			}
			if step, ok := asMap(raw); ok {
				if note := scalarString(step["note"]); note != "" {
					block.Notes = append(block.Notes, note)
				}
			}
		}
	}
	// The code listing is prose a reader can act on, unlike the coordinates.
	if code, ok := body["code"].(string); ok {
		block.Code = strings.TrimSpace(code)
	}
	block.Text = harvestText(spec, body, maxFenceIndexText)
	return block
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v = strings.TrimSpace(v); v != "" {
			return v
		}
	}
	return ""
}

func scalarString(v any) string {
	switch s := v.(type) {
	case string:
		return strings.TrimSpace(s)
	case int, int64, uint64, float64, bool:
		return fmt.Sprint(s)
	}
	return ""
}

// harvestSkip names keys whose strings are references or styling, not words
// a reader would search for.
var harvestSkip = map[string]bool{
	"id": true, "from": true, "to": true, "source": true, "target": true,
	"parent": true, "ref": true, "link": true, "href": true, "kind": true,
	"type": true, "shape": true, "style": true, "layout": true,
	"direction": true, "align": true, "icon": true, "format": true,
}

var colorLiteral = regexp.MustCompile(`^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla|var)\(.*\))$`)

func harvestSkipped(key string) bool {
	lower := strings.ToLower(key)
	return harvestSkip[lower] || strings.Contains(lower, "color") || strings.Contains(lower, "colour") ||
		strings.Contains(lower, "fill") || strings.Contains(lower, "stroke")
}

// harvestText collects the string data a widget draws — labels, node names,
// string cells — so a search for one finds the page.
func harvestText(spec *FenceSpec, body map[string]any, limit int) []string {
	var out []string
	seen := map[string]bool{}
	budget := limit
	var walk func(key string, v any)
	walk = func(key string, v any) {
		if budget <= 0 || harvestSkipped(key) {
			return
		}
		switch val := v.(type) {
		case string:
			s := strings.TrimSpace(val)
			if len([]rune(s)) < 2 || seen[s] || colorLiteral.MatchString(s) || !strings.ContainsFunc(s, unicode.IsLetter) {
				return
			}
			seen[s] = true
			if len(out) > 0 {
				budget-- // the space joining it to the previous one
				if budget <= 0 {
					return
				}
			}
			if r := []rune(s); len(r) > budget {
				s = string(r[:budget])
			}
			budget -= len([]rune(s))
			out = append(out, s)
		case []any:
			for _, item := range val {
				walk(key, item)
			}
		default:
			if m, ok := asMap(v); ok {
				for _, k := range sortedKeys(m) {
					walk(k, m[k])
				}
			}
		}
	}
	collect := func(m map[string]any, reserved func(string) bool) {
		for _, key := range sortedKeys(m) {
			if reserved(key) {
				continue
			}
			if _, attr, ok := spec.attribute(key); ok && len(attr.Matches) > 0 {
				continue
			}
			walk(key, m[key])
		}
	}
	collect(body, func(k string) bool { return reservedTop[k] && !spec.reclaims(k) })
	if props, ok := asMap(body["props"]); ok {
		collect(props, func(string) bool { return false })
	}
	return out
}

// SummarizeWidgetFence reduces a fence body to the prose a reader would get
// without the UI: its title, its caption, the step notes, and the code.
func SummarizeWidgetFence(lang, source string) string {
	return SummarizeWidgetFenceWithMeta(lang, "", source)
}

// SummarizeWidgetFenceWithMeta is SummarizeWidgetFence with the opening
// line's attributes, whose caption= and title= win over the body's.
func SummarizeWidgetFenceWithMeta(lang, meta, source string) string {
	spec, ok := WidgetFence(lang)
	if !ok {
		return ""
	}
	p := parseWidgetFence(spec, lang, source)
	if !p.claims(currentFenceOptions()) {
		return ""
	}
	return summarizeFence(spec, lang, meta, source, p.body).Prose(true)
}

// StripWidgetFences replaces every widget fence with what render returns for
// it, leaving the rest of the page untouched. An empty replacement keeps the
// fence verbatim. Each replacement line takes the opening fence's
// indentation, so a fence inside a list item stays inside it.
//
// Used before indexing, where a body of `activeIndices` and `cellColors` keys
// otherwise pollutes BM25 scoring for every page that draws a picture, and
// before export, where the YAML is noise on the page.
func StripWidgetFences(content string, render func(WidgetFenceBlock) string) string {
	return StripWidgetFencesWithOptions(content, currentFenceOptions(), render)
}

// StripWidgetFencesWithOptions is StripWidgetFences for a given workspace's
// typed-fence settings.
func StripWidgetFencesWithOptions(content string, opts FenceOptions, render func(WidgetFenceBlock) string) string {
	return replaceFenceSpans(content, func(span fenceSpan) string {
		block, ok := claimWidgetFence(span, opts)
		if !ok {
			return ""
		}
		return render(block)
	})
}

// AppFenceBlock is a ```kiwi-app fence: sandboxed HTML a static reader cannot run.
type AppFenceBlock struct {
	Title   string
	Caption string
}

// StripAppFences replaces every ```kiwi-app fence with render's output. An
// empty result keeps the fence as written.
func StripAppFences(content string, render func(AppFenceBlock) string) string {
	return replaceFenceSpans(content, func(span fenceSpan) string {
		if span.lang != "kiwi-app" {
			return ""
		}
		attrs := parseFenceMeta(span.meta)
		return render(AppFenceBlock{
			Title:   attrs["title"],
			Caption: attrs["caption"],
		})
	})
}

// replaceFenceSpans swaps each closed fence for replace's output, re-indented
// to the fence's own margin. An empty replacement leaves the fence alone.
func replaceFenceSpans(content string, replace func(fenceSpan) string) string {
	lines := strings.Split(content, "\n")
	spans := scanFenceSpans(lines)
	if len(spans) == 0 {
		return content
	}
	out := make([]string, 0, len(lines))
	next := 0
	for _, span := range spans {
		if span.end < 0 {
			// Unclosed; lintFences reports it. Keep what we have verbatim.
			break
		}
		replacement := replace(span)
		if replacement == "" {
			continue
		}
		out = append(out, lines[next:span.start]...)
		for _, line := range strings.Split(replacement, "\n") {
			if line != "" {
				line = span.indent + line
			}
			out = append(out, line)
		}
		next = span.end + 1
	}
	out = append(out, lines[next:]...)
	return strings.Join(out, "\n")
}

// claimWidgetFence decides whether a span is a widget. A bare tag whose body
// is something else — a directory listing, a pipe table — renders as a code
// block in the UI, so every other pass has to leave it exactly as it is.
func claimWidgetFence(span fenceSpan, opts FenceOptions) (WidgetFenceBlock, bool) {
	spec, ok := WidgetFence(span.lang)
	if !ok {
		return WidgetFenceBlock{}, false
	}
	source := strings.Join(span.body, "\n")
	p := parseWidgetFence(spec, span.lang, source)
	if !p.claims(opts) {
		return WidgetFenceBlock{}, false
	}
	return summarizeFence(spec, span.lang, span.meta, source, p.body), true
}

// IndexableContent is what the search index should store for a page: widget
// fences reduced to their prose and a bounded sample of their labels. A
// fence with neither is indexed as its label ("array widget"), never as
// its YAML.
func IndexableContent(content string) string {
	return IndexableContentWithOptions(content, currentFenceOptions())
}

// IndexableContentWithOptions is IndexableContent for a given workspace's
// typed-fence settings.
func IndexableContentWithOptions(content string, opts FenceOptions) string {
	return StripWidgetFencesWithOptions(content, opts, indexText)
}

func indexText(b WidgetFenceBlock) string {
	var parts []string
	if prose := b.Prose(true); prose != "" {
		parts = append(parts, prose)
	}
	if len(b.Text) > 0 {
		parts = append(parts, strings.Join(b.Text, " "))
	}
	if len(parts) == 0 {
		return b.Label()
	}
	return strings.Join(parts, "\n")
}

package importer

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/piprate/json-gold/ld"
	"gopkg.in/yaml.v3"
)

// Croissant (https://mlcommons.org/croissant/) describes an ML dataset as
// JSON-LD. Because it is JSON-LD, the property names in the file are only
// labels bound by its `@context`: two emitters can describe the same dataset
// with entirely different keys and both are correct. Kaggle and Hugging Face
// happen to ship near-identical inline contexts today, which is exactly what
// makes hand-parsing the JSON look like it works — until it meets a document
// that aliases a term or spells the namespace `https:` instead of `http:`.
//
// So the document is expanded to absolute IRIs first, and every lookup below
// is keyed on an IRI rather than on whatever the author called it.
const (
	croissantNS = "http://mlcommons.org/croissant/"
	schemaNS    = "https://schema.org/"
	dctNS       = "http://purl.org/dc/terms/"
)

// croissantAliasNS maps the namespace spellings seen in the wild onto the one
// this file keys off. Expansion resolves prefixes but does not unify
// `http://schema.org/` with `https://schema.org/` — to JSON-LD those are two
// unrelated vocabularies, and files using either are common.
var croissantAliasNS = map[string]string{
	"https://mlcommons.org/croissant/": croissantNS,
	"http://schema.org/":               schemaNS,
	"https://purl.org/dc/terms/":       dctNS,
}

//go:embed croissant_context.json
var croissantContextJSON []byte

// croissantHTTPTimeout bounds both the metadata fetch and, indirectly, how
// long `kiwifs import --from croissant --url ...` can hang on a slow host.
const croissantHTTPTimeout = 60 * time.Second

// maxCroissantBytes caps a fetched document. Croissant metadata is descriptive,
// not bulk data; the largest files in the MLCommons corpus are a few hundred KB.
const maxCroissantBytes = 32 << 20

// CroissantSource implements Source for MLCommons Croissant dataset metadata.
//
// Unlike the row-oriented sources, one Croissant document yields exactly one
// record — the dataset — rendered as a page whose `kiwi-data` blocks carry the
// column schema. The schema is the payload; splitting it across files would
// only make it unqueryable as a unit.
type CroissantSource struct {
	dataset *croissantDataset
	origin  string
}

// NewCroissant reads Croissant metadata from a local JSON-LD file.
func NewCroissant(filePath string) (*CroissantSource, error) {
	raw, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("croissant file: %w", err)
	}
	return NewCroissantFromBytes(raw, filePath)
}

// NewCroissantFromURL fetches Croissant metadata over HTTP, e.g. Kaggle's
// https://www.kaggle.com/datasets/{owner}/{name}/croissant/download.
func NewCroissantFromURL(url string) (*CroissantSource, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("croissant url: %w", err)
	}
	req.Header.Set("Accept", "application/ld+json, application/json;q=0.9")
	req.Header.Set("User-Agent", "kiwifs-croissant-import")

	client := &http.Client{Timeout: croissantHTTPTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("croissant fetch %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("croissant fetch %s: HTTP %d", url, resp.StatusCode)
	}

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxCroissantBytes+1))
	if err != nil {
		return nil, fmt.Errorf("croissant fetch %s: %w", url, err)
	}
	if len(raw) > maxCroissantBytes {
		return nil, fmt.Errorf("croissant fetch %s: document exceeds %d bytes", url, maxCroissantBytes)
	}
	return NewCroissantFromBytes(raw, url)
}

// NewCroissantFromBytes parses an in-memory Croissant document. origin is
// recorded as the source ID so a re-import can be matched to its provenance.
//
// Parsing happens here rather than in Stream because Name() feeds the default
// import prefix and is called first — and because a malformed document should
// fail the command, not produce a half-written page.
func NewCroissantFromBytes(raw []byte, origin string) (*CroissantSource, error) {
	ds, err := parseCroissant(raw)
	if err != nil {
		return nil, err
	}
	return &CroissantSource{dataset: ds, origin: origin}, nil
}

// Name is the dataset name, slugified — it becomes the default import prefix,
// so `--from croissant` writes to <dataset-slug>/data.md.
func (s *CroissantSource) Name() string {
	if slug := croissantSlug(s.dataset.Name); slug != "" {
		return slug
	}
	return "croissant"
}

func (s *CroissantSource) Close() error { return nil }

// Stream emits the dataset as a single record whose body is a fully rendered
// page. The generic Run loop picks `_raw_content` up verbatim, which is what
// lets this source emit `kiwi-data` fences that the row-and-column renderer
// could not express.
func (s *CroissantSource) Stream(ctx context.Context) (<-chan Record, <-chan error) {
	records := make(chan Record, 1)
	errs := make(chan error, 1)

	go func() {
		defer close(records)
		defer close(errs)

		rec := Record{
			SourceID:   "croissant:" + s.origin,
			SourceDSN:  s.origin,
			Table:      s.Name(),
			PrimaryKey: "data",
			Fields: map[string]any{
				"_raw_content": string(s.dataset.RenderMarkdown(s.origin)),
			},
		}
		select {
		case records <- rec:
		case <-ctx.Done():
		}
	}()
	return records, errs
}

// --- parsing ---

func parseCroissant(raw []byte) (*croissantDataset, error) {
	var doc any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("croissant: parse json: %w", err)
	}

	proc := ld.NewJsonLdProcessor()
	opts := ld.NewJsonLdOptions("")
	opts.DocumentLoader = newCroissantDocumentLoader()

	expanded, err := proc.Expand(doc, opts)
	if err != nil {
		return nil, fmt.Errorf("croissant: expand json-ld: %w", err)
	}
	normalizeCroissantIRIs(expanded)

	node := findDatasetNode(expanded)
	if node == nil {
		return nil, fmt.Errorf("croissant: no %sDataset node found", schemaNS)
	}
	return buildDataset(node), nil
}

// findDatasetNode locates the sc:Dataset. Expansion flattens nothing, so the
// dataset is normally the sole top-level node; a `@graph` wrapper or a
// catalog listing several datasets puts it one level down instead.
func findDatasetNode(nodes []any) map[string]any {
	for _, n := range nodes {
		m, ok := n.(map[string]any)
		if !ok {
			continue
		}
		if hasType(m, schemaNS+"Dataset") {
			return m
		}
	}
	// A document that omits @type is malformed but still readable, so fall
	// back to a node carrying record sets, or to a lone untyped node. A node
	// typed as something else is not a fallback — a Person document should
	// fail loudly rather than import as an empty dataset.
	for _, n := range nodes {
		if m, ok := n.(map[string]any); ok && len(nodeSlice(m, croissantNS+"recordSet")) > 0 {
			return m
		}
	}
	if len(nodes) == 1 {
		if m, ok := nodes[0].(map[string]any); ok && m["@type"] == nil {
			return m
		}
	}
	return nil
}

type croissantDataset struct {
	Name          string
	Description   string
	URL           string
	License       string
	Version       string
	CiteAs        string
	ConformsTo    string
	DatePublished string
	Keywords      []string
	Creators      []string
	Files         []croissantFile
	RecordSets    []croissantRecordSet
}

type croissantFile struct {
	ID             string
	Name           string
	Description    string
	FileType       string // "file-object" | "file-set"
	EncodingFormat string
	ContentURL     string
	ContentSize    string
	SHA256         string
	MD5            string
	ContainedIn    []string
	Includes       string
}

type croissantRecordSet struct {
	ID          string
	Name        string
	Description string
	DataTypes   []string
	Keys        []string
	Fields      []croissantField
}

type croissantField struct {
	ID           string
	Name         string
	Description  string
	DataTypes    []string
	Column       string
	FileProperty string
	SourceFile   string
	References   string
	Transform    string
	Repeated     bool
}

func buildDataset(n map[string]any) *croissantDataset {
	ds := &croissantDataset{
		Name:          firstValue(n, schemaNS+"name"),
		Description:   firstValue(n, schemaNS+"description"),
		URL:           firstValue(n, schemaNS+"url"),
		Version:       firstValue(n, schemaNS+"version"),
		CiteAs:        firstValue(n, croissantNS+"citeAs"),
		DatePublished: firstValue(n, schemaNS+"datePublished"),
		Keywords:      allValues(n, schemaNS+"keywords"),
	}
	// citeAs was sc:citeAs before Croissant 1.0 moved it under cr:.
	if ds.CiteAs == "" {
		ds.CiteAs = firstValue(n, schemaNS+"citeAs")
	}
	// license and conformsTo are IRIs as often as they are strings.
	ds.License = firstValueOrID(n, schemaNS+"license")
	ds.ConformsTo = firstValueOrID(n, dctNS+"conformsTo")
	if ds.ConformsTo == "" {
		ds.ConformsTo = firstValueOrID(n, croissantNS+"conformsTo")
	}
	// creator is a nested Person/Organization node, not a string.
	for _, c := range nodeSlice(n, schemaNS+"creator") {
		if name := firstValue(c, schemaNS+"name"); name != "" {
			ds.Creators = append(ds.Creators, name)
		} else if id := nodeID(c); id != "" {
			ds.Creators = append(ds.Creators, id)
		}
	}

	for _, d := range nodeSlice(n, schemaNS+"distribution") {
		ds.Files = append(ds.Files, buildFile(d))
	}
	for _, rs := range nodeSlice(n, croissantNS+"recordSet") {
		ds.RecordSets = append(ds.RecordSets, buildRecordSet(rs))
	}
	return ds
}

func buildFile(n map[string]any) croissantFile {
	f := croissantFile{
		ID:             nodeID(n),
		Name:           firstValue(n, schemaNS+"name"),
		Description:    firstValue(n, schemaNS+"description"),
		EncodingFormat: firstValue(n, schemaNS+"encodingFormat"),
		ContentURL:     firstValueOrID(n, schemaNS+"contentUrl"),
		ContentSize:    firstValue(n, schemaNS+"contentSize"),
		SHA256:         firstValue(n, schemaNS+"sha256"),
		MD5:            firstValue(n, croissantNS+"md5"),
		Includes:       firstValue(n, croissantNS+"includes"),
	}
	if f.MD5 == "" {
		f.MD5 = firstValue(n, schemaNS+"md5")
	}
	switch {
	case hasType(n, croissantNS+"FileSet"):
		f.FileType = "file-set"
	case hasType(n, croissantNS+"FileObject"):
		f.FileType = "file-object"
	}
	for _, c := range nodeSlice(n, croissantNS+"containedIn") {
		if id := nodeID(c); id != "" {
			f.ContainedIn = append(f.ContainedIn, id)
		}
	}
	if len(f.ContainedIn) == 0 {
		f.ContainedIn = allIDs(n, schemaNS+"containedIn")
	}
	return f
}

func buildRecordSet(n map[string]any) croissantRecordSet {
	rs := croissantRecordSet{
		ID:          nodeID(n),
		Name:        firstValue(n, schemaNS+"name"),
		Description: firstValue(n, schemaNS+"description"),
		DataTypes:   allIDs(n, croissantNS+"dataType"),
		Keys:        allIDs(n, croissantNS+"key"),
	}
	for _, f := range nodeSlice(n, croissantNS+"field") {
		rs.Fields = append(rs.Fields, buildField(f))
	}
	return rs
}

func buildField(n map[string]any) croissantField {
	f := croissantField{
		ID:          nodeID(n),
		Name:        firstValue(n, schemaNS+"name"),
		Description: firstValue(n, schemaNS+"description"),
		DataTypes:   allIDs(n, croissantNS+"dataType"),
		Repeated:    firstBool(n, croissantNS+"repeated"),
	}
	for _, src := range nodeSlice(n, croissantNS+"source") {
		if f.SourceFile == "" {
			f.SourceFile = firstID(src, croissantNS+"fileObject")
		}
		if f.SourceFile == "" {
			f.SourceFile = firstID(src, croissantNS+"fileSet")
		}
		for _, ex := range nodeSlice(src, croissantNS+"extract") {
			if f.Column == "" {
				f.Column = firstValue(ex, croissantNS+"column")
			}
			if f.FileProperty == "" {
				f.FileProperty = firstValueOrID(ex, croissantNS+"fileProperty")
			}
		}
		for _, tr := range nodeSlice(src, croissantNS+"transform") {
			if f.Transform == "" {
				f.Transform = firstValue(tr, croissantNS+"regex")
			}
			if f.Transform == "" {
				f.Transform = firstValue(tr, croissantNS+"jsonPath")
			}
		}
	}
	// references may point at a field, a fileObject or a fileSet.
	for _, ref := range nodeSlice(n, croissantNS+"references") {
		for _, key := range []string{"field", "fileObject", "fileSet"} {
			if id := firstID(ref, croissantNS+key); id != "" {
				f.References = id
				break
			}
		}
		if f.References == "" {
			f.References = nodeID(ref)
		}
		if f.References != "" {
			break
		}
	}
	return f
}

// --- expanded-document accessors ---
//
// Expanded JSON-LD is fully regular: every property is an array, every value
// is either {"@value": x} or a node object. These helpers exist so the mapping
// code above reads as a mapping and not as a pile of type assertions.

func propSlice(n map[string]any, iri string) []any {
	v, ok := n[iri]
	if !ok {
		return nil
	}
	if arr, ok := v.([]any); ok {
		return arr
	}
	return []any{v}
}

func nodeSlice(n map[string]any, iri string) []map[string]any {
	var out []map[string]any
	for _, item := range propSlice(n, iri) {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func firstValue(n map[string]any, iri string) string {
	for _, item := range propSlice(n, iri) {
		if s := scalarString(item); s != "" {
			return s
		}
	}
	return ""
}

func allValues(n map[string]any, iri string) []string {
	var out []string
	for _, item := range propSlice(n, iri) {
		if s := scalarString(item); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// firstValueOrID accepts either form for properties that are a literal in one
// emitter and an IRI in the next — sc:license is the canonical offender.
func firstValueOrID(n map[string]any, iri string) string {
	for _, item := range propSlice(n, iri) {
		m, ok := item.(map[string]any)
		if !ok {
			if s, ok := item.(string); ok && s != "" {
				return s
			}
			continue
		}
		if s := scalarString(m); s != "" {
			return s
		}
		if id, ok := m["@id"].(string); ok && id != "" {
			return id
		}
	}
	return ""
}

func firstID(n map[string]any, iri string) string {
	ids := allIDs(n, iri)
	if len(ids) == 0 {
		return ""
	}
	return ids[0]
}

func allIDs(n map[string]any, iri string) []string {
	var out []string
	for _, item := range propSlice(n, iri) {
		switch v := item.(type) {
		case string:
			if v != "" {
				out = append(out, v)
			}
		case map[string]any:
			if id, ok := v["@id"].(string); ok && id != "" {
				out = append(out, id)
				continue
			}
			if s := scalarString(v); s != "" {
				out = append(out, s)
			}
		}
	}
	return out
}

func firstBool(n map[string]any, iri string) bool {
	for _, item := range propSlice(n, iri) {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		switch v := m["@value"].(type) {
		case bool:
			return v
		case string:
			return strings.EqualFold(v, "true")
		}
	}
	return false
}

func scalarString(item any) string {
	switch v := item.(type) {
	case string:
		return v
	case map[string]any:
		switch val := v["@value"].(type) {
		case string:
			return val
		case bool:
			if val {
				return "true"
			}
			return "false"
		case float64:
			if val == float64(int64(val)) {
				return fmt.Sprintf("%d", int64(val))
			}
			return fmt.Sprintf("%g", val)
		case nil:
			return ""
		default:
			return fmt.Sprintf("%v", val)
		}
	}
	return ""
}

func nodeID(n map[string]any) string {
	if id, ok := n["@id"].(string); ok {
		return id
	}
	return ""
}

func hasType(n map[string]any, iri string) bool {
	switch v := n["@type"].(type) {
	case string:
		return v == iri
	case []any:
		for _, t := range v {
			if s, ok := t.(string); ok && s == iri {
				return true
			}
		}
	}
	return false
}

// normalizeCroissantIRIs rewrites the alternate namespace spellings in place,
// across property keys, @type and @id, so every lookup can key on one form.
func normalizeCroissantIRIs(v any) {
	switch node := v.(type) {
	case map[string]any:
		var renames [][2]string
		for k, child := range node {
			normalizeCroissantIRIs(child)
			if nk := normalizeIRI(k); nk != k {
				renames = append(renames, [2]string{k, nk})
			}
		}
		for _, r := range renames {
			// A document spelling both forms would otherwise lose one of them.
			if existing, ok := node[r[1]]; ok {
				node[r[1]] = append(propSliceValue(existing), propSliceValue(node[r[0]])...)
			} else {
				node[r[1]] = node[r[0]]
			}
			delete(node, r[0])
		}
		for _, key := range []string{"@id", "@type"} {
			switch tv := node[key].(type) {
			case string:
				node[key] = normalizeIRI(tv)
			case []any:
				for i, t := range tv {
					if s, ok := t.(string); ok {
						tv[i] = normalizeIRI(s)
					}
				}
			}
		}
	case []any:
		for _, item := range node {
			normalizeCroissantIRIs(item)
		}
	}
}

func propSliceValue(v any) []any {
	if arr, ok := v.([]any); ok {
		return arr
	}
	return []any{v}
}

func normalizeIRI(s string) string {
	for from, to := range croissantAliasNS {
		if strings.HasPrefix(s, from) {
			return to + strings.TrimPrefix(s, from)
		}
	}
	return s
}

// --- document loader ---

// croissantDocumentLoader resolves the well-known Croissant contexts from an
// embedded copy and refuses everything else.
//
// json-gold's default loader fetches remote contexts over HTTP. That would
// make an import silently depend on mlcommons.org being reachable, make tests
// non-hermetic, and hand a Croissant file the ability to make the server issue
// a request to a URL of its choosing. Real emitters inline their context, so
// the offline path covers them; a URL reference resolves from the embedded
// copy or fails loudly.
type croissantDocumentLoader struct {
	docs map[string]*ld.RemoteDocument
}

func newCroissantDocumentLoader() *croissantDocumentLoader {
	var ctx any
	// The embedded context is a compile-time constant of this package; a parse
	// failure is a build problem, and an empty loader still handles the inline
	// contexts that every real emitter produces.
	_ = json.Unmarshal(croissantContextJSON, &ctx)

	l := &croissantDocumentLoader{docs: make(map[string]*ld.RemoteDocument)}
	for _, u := range []string{
		"http://mlcommons.org/croissant/",
		"http://mlcommons.org/croissant",
		"http://mlcommons.org/croissant/1.0",
		"http://mlcommons.org/croissant/1.1",
		"https://mlcommons.org/croissant/",
		"https://mlcommons.org/croissant",
		"https://mlcommons.org/croissant/1.0",
		"https://mlcommons.org/croissant/1.1",
	} {
		l.docs[u] = &ld.RemoteDocument{DocumentURL: u, Document: ctx}
	}
	return l
}

func (l *croissantDocumentLoader) LoadDocument(u string) (*ld.RemoteDocument, error) {
	if doc, ok := l.docs[u]; ok {
		return doc, nil
	}
	if doc, ok := l.docs[strings.TrimSuffix(u, "/")]; ok {
		return doc, nil
	}
	return nil, ld.NewJsonLdError(ld.LoadingRemoteContextFailed,
		fmt.Sprintf("croissant: will not fetch remote JSON-LD context %q — "+
			"kiwifs resolves contexts offline; inline the @context in the document", u))
}

// --- rendering ---

// croissantDtypes maps the Croissant/schema.org type IRIs onto short names.
// The raw IRI is preserved alongside in `data-type`; `dtype` exists so a DQL
// query can say `WHERE dtype = "float"` without knowing any of this.
var croissantDtypes = map[string]string{
	schemaNS + "Text":           "text",
	schemaNS + "Integer":        "integer",
	schemaNS + "Float":          "float",
	schemaNS + "Number":         "number",
	schemaNS + "Boolean":        "boolean",
	schemaNS + "Date":           "date",
	schemaNS + "DateTime":       "datetime",
	schemaNS + "Time":           "time",
	schemaNS + "URL":            "url",
	schemaNS + "ImageObject":    "image",
	schemaNS + "AudioObject":    "audio",
	schemaNS + "VideoObject":    "video",
	schemaNS + "Enumeration":    "enumeration",
	croissantNS + "Split":       "split",
	croissantNS + "Label":       "label",
	croissantNS + "BoundingBox": "bounding-box",
}

// primaryDtype picks the first entry that names a primitive type. A field's
// dataType list mixes storage types with semantic annotations — titanic's
// gender label is `[sc:Text, sc:name]` and `sc:name` is not a dtype — so
// "first entry wins" would report the wrong thing on a real file.
func primaryDtype(iris []string) *string {
	for _, iri := range iris {
		if short, ok := croissantDtypes[iri]; ok {
			return &short
		}
	}
	return nil
}

// schemaRecord is one column of one record set. Field order is the struct's,
// not a map's, so the emitted YAML reads as a schema rather than as
// alphabetised noise.
type schemaRecord struct {
	RecordSet    string   `yaml:"record-set"`
	Name         string   `yaml:"name"`
	Dtype        *string  `yaml:"dtype"`
	Description  string   `yaml:"description,omitempty"`
	Column       string   `yaml:"column,omitempty"`
	SourceFile   string   `yaml:"source-file,omitempty"`
	References   string   `yaml:"references,omitempty"`
	FileProperty string   `yaml:"file-property,omitempty"`
	Transform    string   `yaml:"transform,omitempty"`
	Repeated     bool     `yaml:"repeated,omitempty"`
	FieldID      string   `yaml:"field-id"`
	DataType     []string `yaml:"data-type,omitempty"`
}

type fileRecord struct {
	ID             string   `yaml:"id"`
	Name           string   `yaml:"name"`
	FileType       string   `yaml:"file-type,omitempty"`
	EncodingFormat string   `yaml:"encoding-format,omitempty"`
	ContentURL     string   `yaml:"content-url,omitempty"`
	ContentSize    string   `yaml:"content-size,omitempty"`
	Includes       string   `yaml:"includes,omitempty"`
	ContainedIn    []string `yaml:"contained-in,omitempty"`
	Description    string   `yaml:"description,omitempty"`
	SHA256         string   `yaml:"sha256,omitempty"`
	MD5            string   `yaml:"md5,omitempty"`
}

type dataBlockDoc struct {
	Kind    string `yaml:"kind"`
	Records any    `yaml:"records"`
}

// RenderMarkdown builds the page: frontmatter for the dataset metadata layer,
// one `kiwi-data` block per record set, and one for the distribution.
func (ds *croissantDataset) RenderMarkdown(origin string) []byte {
	var buf bytes.Buffer

	buf.WriteString("---\n")
	buf.Write(ds.frontmatterYAML(origin))
	buf.WriteString("---\n\n")

	title := ds.Name
	if title == "" {
		title = "Dataset"
	}
	fmt.Fprintf(&buf, "# %s\n\n", title)
	if ds.Description != "" {
		buf.WriteString(strings.TrimSpace(ds.Description))
		buf.WriteString("\n\n")
	}

	if len(ds.Files) > 0 {
		buf.WriteString("## Files\n\n")
		records := make([]fileRecord, 0, len(ds.Files))
		for _, f := range ds.Files {
			records = append(records, fileRecord{
				ID:             f.ID,
				Name:           orDefault(f.Name, f.ID),
				FileType:       f.FileType,
				EncodingFormat: f.EncodingFormat,
				ContentURL:     f.ContentURL,
				ContentSize:    f.ContentSize,
				Includes:       f.Includes,
				ContainedIn:    f.ContainedIn,
				Description:    collapseWhitespace(f.Description),
				SHA256:         f.SHA256,
				MD5:            f.MD5,
			})
		}
		writeDataBlock(&buf, "dataset-file", records)
	}

	for _, rs := range ds.RecordSets {
		name := orDefault(rs.Name, rs.ID)
		fmt.Fprintf(&buf, "## Record set: %s\n\n", name)
		if rs.Description != "" {
			buf.WriteString(strings.TrimSpace(rs.Description))
			buf.WriteString("\n\n")
		}
		if len(rs.Fields) == 0 {
			buf.WriteString("_No fields declared._\n\n")
			continue
		}
		records := make([]schemaRecord, 0, len(rs.Fields))
		for _, f := range rs.Fields {
			records = append(records, schemaRecord{
				RecordSet:    orDefault(rs.ID, name),
				Name:         localName(orDefault(f.Name, f.ID)),
				Dtype:        primaryDtype(f.DataTypes),
				Description:  collapseWhitespace(f.Description),
				Column:       f.Column,
				SourceFile:   f.SourceFile,
				References:   f.References,
				FileProperty: f.FileProperty,
				Transform:    f.Transform,
				Repeated:     f.Repeated,
				FieldID:      orDefault(f.ID, f.Name),
				DataType:     f.DataTypes,
			})
		}
		writeDataBlock(&buf, "dataset-schema", records)
	}

	return buf.Bytes()
}

func (ds *croissantDataset) frontmatterYAML(origin string) []byte {
	fm := map[string]any{
		"title": ds.Name,
		"kind":  "dataset",
	}
	setIfNotEmpty(fm, "description", collapseWhitespace(ds.Description))
	setIfNotEmpty(fm, "url", ds.URL)
	setIfNotEmpty(fm, "license", ds.License)
	setIfNotEmpty(fm, "version", ds.Version)
	setIfNotEmpty(fm, "cite-as", collapseWhitespace(ds.CiteAs))
	setIfNotEmpty(fm, "conforms-to", ds.ConformsTo)
	setIfNotEmpty(fm, "date-published", ds.DatePublished)
	if len(ds.Keywords) > 0 {
		fm["keywords"] = ds.Keywords
	}
	if len(ds.Creators) > 0 {
		fm["creator"] = ds.Creators
	}
	fm["record-sets"] = len(ds.RecordSets)
	fm["fields"] = ds.fieldCount()
	setIfNotEmpty(fm, "croissant-origin", origin)

	var buf bytes.Buffer
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	_ = enc.Encode(fm)
	_ = enc.Close()
	return buf.Bytes()
}

func (ds *croissantDataset) fieldCount() int {
	n := 0
	for _, rs := range ds.RecordSets {
		n += len(rs.Fields)
	}
	return n
}

// writeDataBlock emits a kiwi-data fence. The fence grows past three backticks
// when the body contains one, so a description quoting a code fence cannot
// terminate the block early and take the rest of the page with it.
func writeDataBlock(buf *bytes.Buffer, kind string, records any) {
	var body bytes.Buffer
	enc := yaml.NewEncoder(&body)
	enc.SetIndent(2)
	if err := enc.Encode(dataBlockDoc{Kind: kind, Records: records}); err != nil {
		// A record set that cannot be serialised is worth saying so in the
		// page rather than emitting a block that will not parse.
		_ = enc.Close()
		fmt.Fprintf(buf, "_Could not render %s block: %v_\n\n", kind, err)
		return
	}
	_ = enc.Close()

	fence := "```"
	for strings.Contains(body.String(), fence) {
		fence += "`"
	}
	buf.WriteString(fence)
	buf.WriteString(markdown.DataBlockFence)
	buf.WriteString("\n")
	buf.Write(body.Bytes())
	buf.WriteString(fence)
	buf.WriteString("\n\n")
}

// --- helpers ---

func orDefault(v, fallback string) string {
	if strings.TrimSpace(v) != "" {
		return v
	}
	return fallback
}

func setIfNotEmpty(m map[string]any, key, value string) {
	if strings.TrimSpace(value) != "" {
		m[key] = value
	}
}

// localName reduces Croissant's compound identifiers ("passengers/name") to
// the column name a reader recognises. field-id keeps the full identifier.
func localName(s string) string {
	if i := strings.LastIndex(s, "/"); i >= 0 && i < len(s)-1 {
		return s[i+1:]
	}
	return s
}

// collapseWhitespace folds a multi-line description onto one line. Descriptions
// are frequently paragraphs; left as-is they turn every YAML record into a
// block scalar and make the schema table unreadable.
func collapseWhitespace(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

func croissantSlug(s string) string {
	var b strings.Builder
	lastDash := true
	for _, r := range strings.ToLower(strings.TrimSpace(s)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		default:
			if !lastDash {
				b.WriteRune('-')
				lastDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}

package markdown

import (
	"errors"
	"fmt"
	"strings"

	"github.com/yuin/goldmark"
	meta "github.com/yuin/goldmark-meta"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"gopkg.in/yaml.v3"
)

// DataBlockFence is the fenced-code info string that marks a block as
// structured, queryable data rather than a code sample.
const DataBlockFence = "kiwi-data"

// MaxDataBlockBytes caps a single kiwi-data block at 256 KB. Same reasoning
// as MaxFrontmatterBytes: yaml.v3 rejects excessive aliasing on its own, but
// a size cap keeps a pathological page from dominating an index pass.
const MaxDataBlockBytes = 256 * 1024

// DataBlock is one ```kiwi-data fence, parsed into records that the DQL
// `FROM RECORDS "<kind>"` source can query.
type DataBlock struct {
	Index   int              `json:"index"` // 0-based position among kiwi-data blocks on the page
	Kind    string           `json:"kind"`
	Line    int              `json:"line"`
	Records []map[string]any `json:"records"`
}

// dataBlockBody is the mapping form of a block body.
type dataBlockBody struct {
	Kind    string           `yaml:"kind"`
	Records []map[string]any `yaml:"records"`
}

// ExtractDataBlocks returns every kiwi-data block on the page.
//
// Three body shapes are accepted:
//
//	kind: dataset-schema        # explicit record list
//	records:
//	  - name: target
//	    dtype: float
//
//	kind: summary               # single record: the mapping minus `kind`
//	ordered: false
//	rows: 750000
//
//	- name: target              # bare list; kind comes from the info string
//	  dtype: float
//
// The info string may carry the kind (```kiwi-data dataset-schema or
// ```kiwi-data kind=dataset-schema); a `kind:` in the body wins.
//
// A block that fails to parse — bad YAML, no kind, no records — is skipped
// and reported in the returned error, but every other block on the page is
// still returned. Callers indexing a page should log the error and index
// what came back rather than dropping the whole page.
func ExtractDataBlocks(content []byte) ([]DataBlock, error) {
	md := goldmark.New(goldmark.WithExtensions(meta.Meta))
	ctx := parser.NewContext()
	doc := md.Parser().Parse(text.NewReader(content), parser.WithContext(ctx))

	var blocks []DataBlock
	var errs []error
	idx := 0

	ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		fcb, ok := n.(*ast.FencedCodeBlock)
		if !ok {
			return ast.WalkContinue, nil
		}
		lang, infoKind := parseDataFenceInfo(fcb, content)
		if lang != DataBlockFence {
			return ast.WalkContinue, nil
		}

		// The index counts every kiwi-data fence, parsed or not, so a
		// block's identity is stable when a sibling block is broken.
		blockIdx := idx
		idx++

		body := fencedBlockText(fcb, content)
		if len(body) > MaxDataBlockBytes {
			errs = append(errs, fmt.Errorf("kiwi-data block %d: body exceeds %d bytes", blockIdx, MaxDataBlockBytes))
			return ast.WalkContinue, nil
		}

		block, err := parseDataBlock(body, infoKind)
		if err != nil {
			errs = append(errs, fmt.Errorf("kiwi-data block %d: %w", blockIdx, err))
			return ast.WalkContinue, nil
		}
		block.Index = blockIdx
		block.Line = lineNumber(content, fcb)
		blocks = append(blocks, *block)
		return ast.WalkContinue, nil
	})

	return blocks, errors.Join(errs...)
}

// parseDataFenceInfo splits the fence info string into its language word and
// an optional kind hint ("kiwi-data dataset-schema" / "kiwi-data kind=x").
func parseDataFenceInfo(fcb *ast.FencedCodeBlock, source []byte) (lang, kind string) {
	if fcb.Info == nil {
		return "", ""
	}
	fields := strings.Fields(string(fcb.Info.Segment.Value(source)))
	if len(fields) == 0 {
		return "", ""
	}
	lang = strings.ToLower(fields[0])
	if len(fields) > 1 {
		kind = strings.TrimPrefix(fields[1], "kind=")
	}
	return lang, kind
}

func fencedBlockText(fcb *ast.FencedCodeBlock, source []byte) []byte {
	var buf []byte
	lines := fcb.Lines()
	for i := 0; i < lines.Len(); i++ {
		seg := lines.At(i)
		buf = append(buf, seg.Value(source)...)
	}
	return buf
}

func parseDataBlock(body []byte, infoKind string) (*DataBlock, error) {
	if len(strings.TrimSpace(string(body))) == 0 {
		return nil, errors.New("empty block")
	}

	var root yaml.Node
	if err := yaml.Unmarshal(body, &root); err != nil {
		return nil, fmt.Errorf("parse yaml: %w", err)
	}
	if len(root.Content) == 0 {
		return nil, errors.New("empty block")
	}

	block := &DataBlock{Kind: infoKind}

	switch root.Content[0].Kind {
	case yaml.SequenceNode:
		var records []map[string]any
		if err := root.Decode(&records); err != nil {
			return nil, fmt.Errorf("parse yaml: %w", err)
		}
		block.Records = records
	case yaml.MappingNode:
		var mapping map[string]any
		if err := root.Decode(&mapping); err != nil {
			return nil, fmt.Errorf("parse yaml: %w", err)
		}
		if k, ok := mapping["kind"].(string); ok && strings.TrimSpace(k) != "" {
			block.Kind = strings.TrimSpace(k)
		}
		if _, hasRecords := mapping["records"]; hasRecords {
			var typed dataBlockBody
			if err := root.Decode(&typed); err != nil {
				return nil, fmt.Errorf("parse yaml: records must be a list of mappings: %w", err)
			}
			block.Records = typed.Records
		} else {
			// Single-record form: the mapping itself, minus the discriminator.
			delete(mapping, "kind")
			if len(mapping) == 0 {
				return nil, errors.New("no records")
			}
			block.Records = []map[string]any{mapping}
		}
	default:
		return nil, errors.New("block must be a mapping or a list")
	}

	if strings.TrimSpace(block.Kind) == "" {
		return nil, errors.New("missing kind")
	}
	// A record list that parsed to nothing usable is an authoring mistake
	// worth surfacing, not a silently empty index entry.
	block.Records = compactRecords(block.Records)
	if len(block.Records) == 0 {
		return nil, errors.New("no records")
	}
	return block, nil
}

func compactRecords(in []map[string]any) []map[string]any {
	out := in[:0]
	for _, r := range in {
		if len(r) > 0 {
			out = append(out, r)
		}
	}
	return out
}

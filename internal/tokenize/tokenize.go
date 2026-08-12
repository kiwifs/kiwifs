// Package tokenize counts tokens for context budgeting.
//
// A `len(text)/4` heuristic is wrong in exactly the direction that hurts:
// markdown tables, code fences, wiki links and CJK text all tokenize far denser
// than 4 bytes per token, so a pack that "fits" a 4000-token budget by that
// rule regularly overflows the model's real window. Counting is cheap; being
// wrong costs a truncated prompt.
package tokenize

import (
	"strings"
	"sync"
	"unicode"

	"github.com/pkoukk/tiktoken-go"
	tiktokenloader "github.com/pkoukk/tiktoken-go-loader"
)

// DefaultEncoding is the BPE vocabulary used when the caller does not pick one.
// cl100k_base is not Claude's tokenizer and is not exactly anyone else's
// either — no server-side counter can be, since it does not know which model
// will read the pack. It is close enough across modern models to keep a budget
// honest, and it is deterministic and offline, which the alternatives are not.
const DefaultEncoding = "cl100k_base"

// Counter counts tokens in a string.
type Counter interface {
	Count(s string) int
	// Name identifies the counting method, so a caller comparing two runs can
	// tell whether the numbers are comparable.
	Name() string
}

var (
	loaderOnce sync.Once
	encMu      sync.Mutex
	encCache   = map[string]*tiktoken.Tiktoken{}
)

// NewCounter returns a Counter for the named BPE encoding, falling back to a
// heuristic Counter (and a non-nil error) if the encoding cannot be loaded.
// The fallback is deliberate: a token count that is roughly right beats a
// failed request, and Name() tells the caller which one they got.
func NewCounter(encoding string) (Counter, error) {
	if encoding == "" {
		encoding = DefaultEncoding
	}
	// The offline loader embeds the BPE ranks in the binary. tiktoken-go's
	// default loader fetches them from a CDN on first use, which would break
	// both the single-binary property and air-gapped installs.
	loaderOnce.Do(func() {
		tiktoken.SetBpeLoader(tiktokenloader.NewOfflineLoader())
	})

	encMu.Lock()
	defer encMu.Unlock()
	if enc, ok := encCache[encoding]; ok {
		return &bpeCounter{name: encoding, enc: enc}, nil
	}
	enc, err := tiktoken.GetEncoding(encoding)
	if err != nil {
		return EstimateCounter{}, err
	}
	encCache[encoding] = enc
	return &bpeCounter{name: encoding, enc: enc}, nil
}

type bpeCounter struct {
	name string
	enc  *tiktoken.Tiktoken
}

func (c *bpeCounter) Count(s string) int {
	if s == "" {
		return 0
	}
	return len(c.enc.Encode(s, nil, nil))
}

func (c *bpeCounter) Name() string { return c.name }

// EstimateCounter is the fallback when no BPE vocabulary is available. It
// splits on word boundaries and charges long words and non-ASCII runes extra,
// which tracks real tokenizers far better than dividing bytes by four.
type EstimateCounter struct{}

func (EstimateCounter) Name() string { return "estimate" }

func (EstimateCounter) Count(s string) int {
	if strings.TrimSpace(s) == "" {
		return 0
	}
	total := 0
	for _, field := range strings.FieldsFunc(s, func(r rune) bool {
		return unicode.IsSpace(r)
	}) {
		runes := []rune(field)
		nonASCII := 0
		for _, r := range runes {
			if r > unicode.MaxASCII {
				nonASCII++
			}
		}
		// CJK and emoji commonly cost one token or more per rune.
		total += nonASCII
		ascii := len(runes) - nonASCII
		if ascii > 0 {
			// Roughly one token per four ASCII characters, minimum one, plus
			// one for the leading space most BPE vocabularies encode.
			total += (ascii + 3) / 4
		}
	}
	if total == 0 {
		return 1
	}
	return total
}

package importer

import (
	"math"
	"sort"
	"strings"
	"unicode"
)

// ExtractKeywords computes TF-IDF keywords for a text section.
func ExtractKeywords(text string, corpusDF map[string]int, totalDocs int, maxKeywords int) []string {
	words := tokenize(text)
	if len(words) == 0 {
		return nil
	}

	tf := make(map[string]int)
	for _, w := range words {
		tf[w]++
	}

	type scored struct {
		word  string
		score float64
	}
	var scores []scored
	for word, count := range tf {
		if len(word) < 3 || isStopWord(word) {
			continue
		}
		termFreq := float64(count) / float64(len(words))
		score := termFreq
		if totalDocs > 1 {
			df := corpusDF[word]
			if df == 0 {
				df = 1
			}
			idf := math.Log(float64(totalDocs+1) / float64(df+1))
			score = termFreq * idf
		}
		scores = append(scores, scored{word, score})
	}

	sort.Slice(scores, func(i, j int) bool {
		if scores[i].score != scores[j].score {
			return scores[i].score > scores[j].score
		}
		return scores[i].word < scores[j].word
	})

	result := make([]string, 0, maxKeywords)
	for i, s := range scores {
		if i >= maxKeywords {
			break
		}
		result = append(result, s.word)
	}
	return result
}

func tokenize(text string) []string {
	var words []string
	for _, word := range strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		if len(word) >= 2 {
			words = append(words, word)
		}
	}
	return words
}

func isStopWord(w string) bool {
	stops := map[string]bool{
		"the": true, "and": true, "for": true, "are": true, "but": true,
		"not": true, "you": true, "all": true, "can": true, "had": true,
		"her": true, "was": true, "one": true, "our": true, "out": true,
		"has": true, "have": true, "been": true, "this": true, "that": true,
		"with": true, "from": true, "they": true, "will": true, "each": true,
		"which": true, "their": true, "there": true, "about": true, "would": true,
		"these": true, "other": true, "than": true, "then": true, "into": true,
	}
	return stops[w]
}

// BuildCorpusDF builds the document frequency map from all sections.
func BuildCorpusDF(sections []string) map[string]int {
	df := make(map[string]int)
	for _, section := range sections {
		seen := make(map[string]bool)
		for _, word := range tokenize(section) {
			if !seen[word] {
				df[word]++
				seen[word] = true
			}
		}
	}
	return df
}

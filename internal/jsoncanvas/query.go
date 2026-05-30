package jsoncanvas

import (
	"encoding/json"
	"strings"
)

// QueryParams filters canvas nodes and edges.
type QueryParams struct {
	NodeType   string // filter nodes by type (text, file, link, group)
	Search     string // substring match against text, file, url, label fields
	Connected  string // return nodes + edges connected to this node ID
	NodesOnly  bool   // omit edges from result
	EdgesOnly  bool   // omit nodes from result
}

// QueryResult contains the filtered subset.
type QueryResult struct {
	Nodes []json.RawMessage `json:"nodes" swaggertype:"array,object"`
	Edges []json.RawMessage `json:"edges" swaggertype:"array,object"`
}

// Query filters a canvas document and returns matching elements.
func Query(doc []byte, q QueryParams) (*QueryResult, error) {
	var canvas struct {
		Nodes []json.RawMessage `json:"nodes"`
		Edges []json.RawMessage `json:"edges"`
	}
	if err := json.Unmarshal(doc, &canvas); err != nil {
		return nil, err
	}

	res := &QueryResult{
		Nodes: []json.RawMessage{},
		Edges: []json.RawMessage{},
	}

	// Build a set of matching node IDs for edge filtering.
	matchedNodeIDs := map[string]bool{}

	if !q.EdgesOnly {
		for _, raw := range canvas.Nodes {
			if matchNode(raw, q) {
				res.Nodes = append(res.Nodes, raw)
				id, _ := extractID(raw)
				matchedNodeIDs[id] = true
			}
		}
	}

	if !q.NodesOnly {
		for _, raw := range canvas.Edges {
			if matchEdge(raw, q, matchedNodeIDs) {
				res.Edges = append(res.Edges, raw)
			}
		}
	}

	return res, nil
}

func matchNode(raw json.RawMessage, q QueryParams) bool {
	var n struct {
		ID   string `json:"id"`
		Type string `json:"type"`
		Text string `json:"text"`
		File string `json:"file"`
		URL  string `json:"url"`
	}
	_ = json.Unmarshal(raw, &n)

	if q.NodeType != "" && n.Type != q.NodeType {
		return false
	}

	if q.Connected != "" && n.ID != q.Connected {
		return false
	}

	if q.Search != "" {
		lower := strings.ToLower(q.Search)
		if !strings.Contains(strings.ToLower(n.Text), lower) &&
			!strings.Contains(strings.ToLower(n.File), lower) &&
			!strings.Contains(strings.ToLower(n.URL), lower) &&
			!strings.Contains(strings.ToLower(n.ID), lower) {
			return false
		}
	}

	return true
}

func matchEdge(raw json.RawMessage, q QueryParams, matchedNodes map[string]bool) bool {
	var e struct {
		ID       string `json:"id"`
		FromNode string `json:"fromNode"`
		ToNode   string `json:"toNode"`
		Label    string `json:"label"`
	}
	_ = json.Unmarshal(raw, &e)

	if q.Connected != "" {
		if e.FromNode != q.Connected && e.ToNode != q.Connected {
			return false
		}
		return true
	}

	if q.Search != "" {
		lower := strings.ToLower(q.Search)
		if strings.Contains(strings.ToLower(e.Label), lower) ||
			strings.Contains(strings.ToLower(e.ID), lower) {
			return true
		}
		if matchedNodes[e.FromNode] || matchedNodes[e.ToNode] {
			return true
		}
		return false
	}

	return true
}

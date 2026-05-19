package main

import "encoding/json"

type request struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type response struct {
	Result any    `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
}

type compileParams struct {
	Source string `json:"source"`
}

type nodeAtParams struct {
	Source string `json:"source"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
}

type renameNodeParams struct {
	Source  string `json:"source"`
	ID      string `json:"id"`
	NewName string `json:"newName"`
}

type renameNodeResult struct {
	Source string `json:"source"`
	ID     string `json:"id"`
}

type exportParams struct {
	Source string `json:"source"`
	Format string `json:"format"`
}

type completeParams struct {
	Source string `json:"source"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
}

type diagnostic struct {
	Message     string      `json:"message"`
	Severity    string      `json:"severity"`
	SourceRange sourceRange `json:"sourceRange"`
}

type sourceRange struct {
	File        string `json:"file"`
	StartLine   int    `json:"startLine"`
	StartColumn int    `json:"startColumn"`
	EndLine     int    `json:"endLine"`
	EndColumn   int    `json:"endColumn"`
}

type previewBox struct {
	X      *float64 `json:"x,omitempty"`
	Y      *float64 `json:"y,omitempty"`
	Width  *float64 `json:"width,omitempty"`
	Height *float64 `json:"height,omitempty"`
	Route  []point  `json:"route,omitempty"`
}

type point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type objectMap struct {
	ID           string        `json:"id"`
	Kind         string        `json:"kind"`
	BoardPath    []string      `json:"boardPath"`
	Label        string        `json:"label,omitempty"`
	Src          string        `json:"src,omitempty"`
	Dst          string        `json:"dst,omitempty"`
	SourceRanges []sourceRange `json:"sourceRanges"`
	Preview      previewBox    `json:"preview"`
}

type compileResult struct {
	SVG         string       `json:"svg"`
	Objects     []objectMap  `json:"objects"`
	Diagnostics []diagnostic `json:"diagnostics"`
}

type exportResult struct {
	Format string `json:"format"`
	Data   string `json:"data"`
}

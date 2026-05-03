package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strings"

	"oss.terrastruct.com/d2/d2ast"
	"oss.terrastruct.com/d2/d2format"
	"oss.terrastruct.com/d2/d2graph"
	"oss.terrastruct.com/d2/d2layouts/d2dagrelayout"
	"oss.terrastruct.com/d2/d2lib"
	"oss.terrastruct.com/d2/d2lsp"
	"oss.terrastruct.com/d2/d2renderers/d2svg"
	"oss.terrastruct.com/d2/d2target"
	"oss.terrastruct.com/d2/lib/log"
	"oss.terrastruct.com/d2/lib/textmeasure"
	"oss.terrastruct.com/util-go/go2"
)

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
	Layout string `json:"layout,omitempty"`
	Theme  int64  `json:"theme,omitempty"`
}

type nodeAtParams struct {
	Source string `json:"source"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
}

type exportParams struct {
	Source string `json:"source"`
	Format string `json:"format"`
	Layout string `json:"layout,omitempty"`
	Theme  int64  `json:"theme,omitempty"`
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

func main() {
	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		write(response{Error: err.Error()})
		return
	}
	var req request
	if err := json.Unmarshal(raw, &req); err != nil {
		write(response{Error: err.Error()})
		return
	}
	result, err := handle(req)
	if err != nil {
		write(response{Error: err.Error()})
		return
	}
	write(response{Result: result})
}

func handle(req request) (any, error) {
	switch req.Method {
	case "compile":
		var params compileParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		return compile(params)
	case "format":
		var params compileParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		return format(params.Source)
	case "nodeAt":
		var params nodeAtParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		return nodeAt(params), nil
	case "complete":
		var params completeParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		return d2lsp.GetCompletionItems(params.Source, params.Line, params.Column)
	case "export":
		var params exportParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		return export(params)
	default:
		return nil, fmt.Errorf("unknown method %q", req.Method)
	}
}

func compile(params compileParams) (compileResult, error) {
	diagram, svg, err := render(params.Source, params.Layout, params.Theme)
	result := compileResult{
		SVG:         string(svg),
		Objects:     buildObjectMap(params.Source, diagram),
		Diagnostics: []diagnostic{},
	}
	if err != nil {
		result.Diagnostics = append(result.Diagnostics, diagnostic{
			Message:     err.Error(),
			Severity:    "error",
			SourceRange: sourceRange{File: "main.d2", StartLine: 1, StartColumn: 1, EndLine: 1, EndColumn: 1},
		})
		if len(svg) == 0 {
			result.SVG = fallbackSVG(err.Error())
		}
	}
	return result, nil
}

func render(source, layout string, theme int64) (*d2target.Diagram, []byte, error) {
	ruler, err := textmeasure.NewRuler()
	if err != nil {
		return nil, nil, err
	}
	layoutResolver := func(engine string) (d2graph.LayoutGraph, error) {
		if engine != "" && engine != "dagre" {
			return nil, fmt.Errorf("layout %q is not bundled in this MVP", engine)
		}
		return d2dagrelayout.DefaultLayout, nil
	}
	if layout == "" {
		layout = "dagre"
	}
	renderOpts := &d2svg.RenderOpts{
		Pad:     go2.Pointer(int64(24)),
		ThemeID: &theme,
	}
	compileOpts := &d2lib.CompileOptions{
		Layout:         &layout,
		LayoutResolver: layoutResolver,
		Ruler:          ruler,
		UTF16Pos:       true,
		InputPath:      "main.d2",
	}
	ctx := log.WithDefault(context.Background())
	diagram, _, err := d2lib.Compile(ctx, source, compileOpts, renderOpts)
	if diagram == nil {
		return nil, nil, err
	}
	svg, renderErr := d2svg.Render(diagram, renderOpts)
	return diagram, svg, errors.Join(err, renderErr)
}

func format(source string) (string, error) {
	ast, err := d2lib.Parse(log.WithDefault(context.Background()), source, &d2lib.CompileOptions{UTF16Pos: true})
	if err != nil && ast == nil {
		return "", err
	}
	return d2format.Format(ast), nil
}

func export(params exportParams) (exportResult, error) {
	_, svg, err := render(params.Source, params.Layout, params.Theme)
	if err != nil && len(svg) == 0 {
		return exportResult{}, err
	}
	switch strings.ToLower(params.Format) {
	case "svg":
		return exportResult{Format: "svg", Data: base64.StdEncoding.EncodeToString(svg)}, nil
	case "png", "pdf":
		return exportResult{}, fmt.Errorf("%s export needs a raster/pdf renderer and is not wired yet", strings.ToUpper(params.Format))
	default:
		return exportResult{}, fmt.Errorf("unsupported export format %q", params.Format)
	}
}

func buildObjectMap(source string, diagram *d2target.Diagram) []objectMap {
	sourceRanges := scanSourceRanges(source)
	if diagram == nil {
		return nil
	}
	objects := make([]objectMap, 0, len(diagram.Shapes)+len(diagram.Connections))
	for _, shape := range diagram.Shapes {
		x, y := float64(shape.Pos.X), float64(shape.Pos.Y)
		w, h := float64(shape.Width), float64(shape.Height)
		objects = append(objects, objectMap{
			ID:           shape.ID,
			Kind:         "shape",
			BoardPath:    []string{},
			Label:        shape.Label,
			SourceRanges: nonNilRanges(rangesFor(shape.ID, sourceRanges)),
			Preview:      previewBox{X: &x, Y: &y, Width: &w, Height: &h},
		})
	}
	for _, conn := range diagram.Connections {
		route := make([]point, 0, len(conn.Route))
		for _, p := range conn.Route {
			if p != nil {
				route = append(route, point{X: p.X, Y: p.Y})
			}
		}
		objects = append(objects, objectMap{
			ID:           conn.ID,
			Kind:         "connection",
			BoardPath:    []string{},
			Label:        conn.Label,
			SourceRanges: nonNilRanges(rangesForConnection(conn.Src, conn.Dst, sourceRanges)),
			Preview:      previewBox{Route: route},
		})
	}
	sort.SliceStable(objects, func(i, j int) bool {
		if objects[i].Kind == objects[j].Kind {
			return objects[i].ID < objects[j].ID
		}
		return objects[i].Kind == "shape"
	})
	return objects
}

func nodeAt(params nodeAtParams) map[string]string {
	for _, obj := range buildObjectMap(params.Source, nilFallbackDiagram(params.Source)) {
		for _, r := range obj.SourceRanges {
			if contains(r, params.Line, params.Column) {
				return map[string]string{"id": obj.ID}
			}
		}
	}
	for id, ranges := range scanSourceRanges(params.Source) {
		for _, r := range ranges {
			if contains(r, params.Line, params.Column) {
				return map[string]string{"id": id}
			}
		}
	}
	return map[string]string{}
}

func nilFallbackDiagram(source string) *d2target.Diagram {
	diagram, _, _ := render(source, "dagre", 0)
	return diagram
}

func contains(r sourceRange, line, column int) bool {
	if line < r.StartLine || line > r.EndLine {
		return false
	}
	if line == r.StartLine && column < r.StartColumn {
		return false
	}
	if line == r.EndLine && column > r.EndColumn {
		return false
	}
	return true
}

var identifierRE = regexp.MustCompile(`[A-Za-z0-9_.$-]+`)

func scanSourceRanges(source string) map[string][]sourceRange {
	out := map[string][]sourceRange{}
	lines := strings.Split(source, "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "//") {
			continue
		}
		if idx := strings.Index(line, "->"); idx >= 0 {
			addTokenRange(out, line[:idx], i+1, 0)
			addTokenRange(out, line[idx+2:], i+1, idx+2)
			continue
		}
		left := line
		if idx := strings.IndexAny(line, ":{"); idx >= 0 {
			left = line[:idx]
		}
		addTokenRange(out, left, i+1, 0)
	}
	return out
}

func addTokenRange(out map[string][]sourceRange, text string, line int, baseColumn int) {
	if idx := strings.IndexAny(text, ":{"); idx >= 0 {
		text = text[:idx]
	}
	tokenText := text
	if idx := strings.Index(tokenText, "->"); idx >= 0 {
		tokenText = tokenText[:idx]
	}
	token := strings.Trim(strings.TrimSpace(tokenText), `"'`)
	token = strings.TrimSuffix(token, ".")
	if token == "" {
		return
	}
	loc := identifierRE.FindStringIndex(text)
	if loc == nil {
		return
	}
	start := loc[0] + 1
	end := loc[1] + 1
	out[token] = append(out[token], sourceRange{
		File:        "main.d2",
		StartLine:   line,
		StartColumn: baseColumn + start,
		EndLine:     line,
		EndColumn:   baseColumn + end,
	})
}

func rangesFor(id string, ranges map[string][]sourceRange) []sourceRange {
	if ranges[id] != nil {
		return ranges[id]
	}
	parts := strings.Split(id, ".")
	if len(parts) > 0 && ranges[parts[len(parts)-1]] != nil {
		return ranges[parts[len(parts)-1]]
	}
	return nil
}

func nonNilRanges(ranges []sourceRange) []sourceRange {
	if ranges == nil {
		return []sourceRange{}
	}
	return ranges
}

func rangesForConnection(src, dst string, ranges map[string][]sourceRange) []sourceRange {
	combined := append([]sourceRange{}, rangesFor(src, ranges)...)
	combined = append(combined, rangesFor(dst, ranges)...)
	return combined
}

func fallbackSVG(message string) string {
	var escaped bytes.Buffer
	json.HTMLEscape(&escaped, []byte(message))
	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#fff7ed"/><text x="28" y="42" fill="#9a3412" font-family="monospace" font-size="16">D2 compile error</text><text x="28" y="76" fill="#431407" font-family="monospace" font-size="13">%s</text></svg>`, escaped.String())
}

func write(resp response) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(resp)
}

var _ d2ast.Node

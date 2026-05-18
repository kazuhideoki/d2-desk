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

type completionItem struct {
	Label      string `json:"label"`
	Kind       string `json:"kind"`
	Detail     string `json:"detail"`
	InsertText string `json:"insertText"`
}

var d2KeyCompletionItems = buildD2KeyCompletionItems()

var d2StyleKeyCompletionItems = buildD2StyleKeyCompletionItems()

var d2ArrowheadKeyCompletionItems = completionItemsForLabels([]string{
	"shape",
	"label",
	"style.filled",
}, "arrowhead property", "keyword")

var d2LabelKeyCompletionItems = completionItemsForLabels([]string{
	"near",
}, "label property", "keyword")

var d2ConfigKeyCompletionItems = completionItemsForLabels([]string{
	"sketch",
	"theme-id",
	"dark-theme-id",
	"pad",
	"layout-engine",
	"center",
	"theme-overrides",
	"dark-theme-overrides",
	"data",
}, "config property", "keyword")

var d2ThemeOverrideKeyCompletionItems = completionItemsForLabels([]string{
	"N1", "N2", "N3", "N4", "N5", "N6", "N7",
	"B1", "B2", "B3", "B4", "B5", "B6",
	"AA2", "AA4", "AA5", "AB4", "AB5",
}, "theme override", "keyword")

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
		return complete(params)
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

func complete(params completeParams) ([]completionItem, error) {
	items, err := d2lsp.GetCompletionItems(params.Source, params.Line, params.Column)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		probeSource, probeColumn := completionProbeWithoutCurrentValue(params.Source, params.Line, params.Column)
		if probeSource != params.Source || probeColumn != params.Column {
			items, err = d2lsp.GetCompletionItems(probeSource, params.Line, probeColumn)
			if err != nil {
				return nil, err
			}
		}
	}
	if completions := d2ContextValueCompletions(params); completions != nil {
		return completions, nil
	}
	if len(items) == 0 {
		completions := d2KeyCompletions(params)
		if len(completions) > 0 {
			return completions, nil
		}
	}
	completions := make([]completionItem, 0, len(items))
	for _, item := range items {
		completions = append(completions, completionItem{
			Label:      item.Label,
			Kind:       completionKind(item.Kind),
			Detail:     item.Detail,
			InsertText: item.InsertText,
		})
	}
	return completions, nil
}

func mergeCompletionItems(primary, supplemental []completionItem) []completionItem {
	if len(supplemental) == 0 {
		return primary
	}
	seen := make(map[string]struct{}, len(primary)+len(supplemental))
	for _, item := range primary {
		seen[item.Label] = struct{}{}
	}
	for _, item := range supplemental {
		if _, ok := seen[item.Label]; ok {
			continue
		}
		seen[item.Label] = struct{}{}
		primary = append(primary, item)
	}
	return primary
}

func buildD2KeyCompletionItems() []completionItem {
	seen := map[string]struct{}{}
	labels := make([]string, 0, len(d2ast.SimpleReservedKeywords)+len(d2ast.CompositeReservedKeywords)+len(d2ast.BoardKeywords))
	appendMapKeys(&labels, seen, d2ast.SimpleReservedKeywords)
	appendMapKeys(&labels, seen, d2ast.CompositeReservedKeywords)
	appendMapKeys(&labels, seen, d2ast.BoardKeywords)
	sort.Strings(labels)
	return completionItemsForLabels(labels, "property", "keyword")
}

func buildD2StyleKeyCompletionItems() []completionItem {
	seen := map[string]struct{}{}
	labels := make([]string, 0, len(d2ast.StyleKeywords))
	appendMapKeys(&labels, seen, d2ast.StyleKeywords)
	sort.Strings(labels)
	return completionItemsForLabels(labels, "style property", "style")
}

func appendMapKeys(labels *[]string, seen map[string]struct{}, values map[string]struct{}) {
	for value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		*labels = append(*labels, value)
	}
}

func completionItemsForLabels(labels []string, detail, kind string) []completionItem {
	items := make([]completionItem, 0, len(labels))
	for _, label := range labels {
		items = append(items, completionItem{
			Label:      label,
			Kind:       kind,
			Detail:     detail,
			InsertText: label + ": ",
		})
	}
	return items
}

func d2KeyCompletions(params completeParams) []completionItem {
	lines := strings.Split(params.Source, "\n")
	if params.Line < 0 || params.Line >= len(lines) {
		return nil
	}

	lineText := lines[params.Line]
	column := clamp(params.Column, 0, len(lineText))
	start := column
	for start > 0 && isCompletionValueChar(lineText[start-1]) {
		start--
	}
	if start == column && !isD2KeyCompletionBoundary(lineText[:start]) {
		return nil
	}
	if !isD2KeyCompletionBoundary(lineText[:start]) {
		return nil
	}

	typedKey := lineText[start:column]
	items := d2KeyItemsForContext(completionKeyContext(params.Source, params.Line, start))
	completions := make([]completionItem, 0, len(items))
	for _, item := range items {
		if strings.HasPrefix(item.Label, typedKey) {
			completions = append(completions, item)
		}
	}
	return completions
}

func d2KeyItemsForContext(context []string) []completionItem {
	if hasTrailingContext(context, "vars", "d2-config") {
		return d2ConfigKeyCompletionItems
	}
	if hasTrailingContext(context, "theme-overrides") || hasTrailingContext(context, "dark-theme-overrides") {
		return d2ThemeOverrideKeyCompletionItems
	}
	if hasTrailingContext(context, "source-arrowhead") || hasTrailingContext(context, "target-arrowhead") {
		return d2ArrowheadKeyCompletionItems
	}
	if hasTrailingContext(context, "label") || hasTrailingContext(context, "icon") || hasTrailingContext(context, "tooltip") {
		return d2LabelKeyCompletionItems
	}
	if hasTrailingContext(context, "style") {
		return d2StyleKeyCompletionItems
	}
	return d2KeyCompletionItems
}

func d2ContextValueCompletions(params completeParams) []completionItem {
	context := completionKeyContext(params.Source, params.Line, params.Column)
	if len(context) == 0 {
		return nil
	}

	last := context[len(context)-1]
	switch {
	case hasTrailingContext(context, "vars", "d2-config", "sketch"),
		hasTrailingContext(context, "vars", "d2-config", "center"):
		return booleanCompletions()
	case hasTrailingContext(context, "vars", "d2-config", "layout-engine"):
		return []completionItem{{
			Label:      "(layout engine)",
			Kind:       "keyword",
			Detail:     "e.g. dagre, elk",
			InsertText: "",
		}}
	case hasTrailingContext(context, "vars", "d2-config", "theme-id"),
		hasTrailingContext(context, "vars", "d2-config", "dark-theme-id"),
		hasTrailingContext(context, "vars", "d2-config", "pad"):
		return []completionItem{{
			Label:      "(integer)",
			Kind:       "keyword",
			Detail:     "number",
			InsertText: "",
		}}
	case hasTrailingContext(context, "theme-overrides", last),
		hasTrailingContext(context, "dark-theme-overrides", last):
		return colorCompletions()
	case last == "font":
		return completionItemsWithInsertText([]string{"default", "mono"}, "font", "keyword")
	case hasTrailingContext(context, "source-arrowhead", "shape"),
		hasTrailingContext(context, "target-arrowhead", "shape"):
		return arrowheadShapeCompletions()
	case hasTrailingContext(context, "label", "near"),
		hasTrailingContext(context, "icon", "near"):
		return labelPositionCompletions()
	case hasTrailingContext(context, "tooltip", "near"):
		return tooltipPositionCompletions()
	case last == "link":
		return []completionItem{{
			Label:      "(URL or board path)",
			Kind:       "keyword",
			Detail:     "link",
			InsertText: "",
		}}
	case last == "grid-rows" || last == "grid-columns":
		return []completionItem{{
			Label:      "(positive integer)",
			Kind:       "keyword",
			Detail:     "grid",
			InsertText: "",
		}}
	case last == "grid-gap" || last == "vertical-gap" || last == "horizontal-gap":
		return []completionItem{{
			Label:      "(non-negative integer)",
			Kind:       "keyword",
			Detail:     "grid",
			InsertText: "",
		}}
	case last == "near":
		return nearConstantCompletions()
	}
	return nil
}

func arrowheadShapeCompletions() []completionItem {
	labels := make([]string, 0, len(d2target.Arrowheads))
	for arrowhead := range d2target.Arrowheads {
		labels = append(labels, arrowhead)
	}
	sort.Strings(labels)
	return completionItemsWithInsertText(labels, "arrowhead shape", "shape")
}

func booleanCompletions() []completionItem {
	return completionItemsWithInsertText([]string{"true", "false"}, "boolean", "keyword")
}

func colorCompletions() []completionItem {
	return []completionItem{{
		Label:      "(color name or hex code)",
		Kind:       "keyword",
		Detail:     "e.g. blue, #ff0000",
		InsertText: "",
	}}
}

func nearConstantCompletions() []completionItem {
	return completionItemsWithInsertText(d2ast.NearConstantsArray, "near position", "keyword")
}

func labelPositionCompletions() []completionItem {
	return completionItemsWithInsertText(d2ast.LabelPositionsArray, "label position", "keyword")
}

func tooltipPositionCompletions() []completionItem {
	return completionItemsWithInsertText(d2ast.TooltipPositionsArray, "tooltip position", "keyword")
}

func completionItemsWithInsertText(labels []string, detail, kind string) []completionItem {
	items := make([]completionItem, 0, len(labels))
	for _, label := range labels {
		items = append(items, completionItem{
			Label:      label,
			Kind:       kind,
			Detail:     detail,
			InsertText: label,
		})
	}
	return items
}

func isD2KeyCompletionBoundary(prefix string) bool {
	trimmedPrefix := strings.TrimRight(prefix, " \t")
	if trimmedPrefix == "" {
		return true
	}
	if strings.HasSuffix(trimmedPrefix, ":") || strings.HasSuffix(trimmedPrefix, "->") {
		return false
	}
	switch trimmedPrefix[len(trimmedPrefix)-1] {
	case '{', ';', '.':
		return true
	default:
		return false
	}
}

type completionContextFrame struct {
	parts []string
}

func completionKeyContext(source string, line, column int) []string {
	lines := strings.Split(source, "\n")
	if line < 0 || line >= len(lines) {
		return nil
	}

	frames := make([]completionContextFrame, 0, 4)
	for index := 0; index <= line; index++ {
		limit := len(lines[index])
		if index == line {
			limit = clamp(column, 0, limit)
		}
		frames = scanCompletionContextLine(frames, lines[index], limit)
	}

	context := flattenCompletionContext(frames)
	currentPrefix := stripD2LineComment(lines[line][:clamp(column, 0, len(lines[line]))])
	trimmedPrefix := strings.TrimRight(currentPrefix, " \t")
	if strings.HasSuffix(trimmedPrefix, ".") {
		if key := extractD2KeyPath(strings.TrimSuffix(trimmedPrefix, ".")); len(key) > 0 {
			return append(context, key...)
		}
		return context
	}

	colonIndex := strings.LastIndex(currentPrefix, ":")
	if colonIndex < 0 {
		return context
	}
	suffix := currentPrefix[colonIndex+1:]
	if strings.ContainsAny(suffix, ";{}") {
		return context
	}
	if key := extractD2KeyPath(currentPrefix[:colonIndex]); len(key) > 0 {
		context = append(context, key...)
	}
	return context
}

func scanCompletionContextLine(frames []completionContextFrame, text string, limit int) []completionContextFrame {
	quote := byte(0)
	for index := 0; index < limit; index++ {
		char := text[index]
		if quote != 0 {
			if char == '\\' {
				index++
			} else if char == quote {
				quote = 0
			}
			continue
		}
		if char == '"' || char == '\'' {
			quote = char
			continue
		}
		if char == '#' || (char == '/' && index+1 < limit && text[index+1] == '/') {
			return frames
		}
		switch char {
		case '{':
			prefix := text[:index]
			colonIndex := strings.LastIndex(prefix, ":")
			if colonIndex < 0 {
				continue
			}
			if key := extractD2KeyPath(prefix[:colonIndex]); len(key) > 0 {
				frames = append(frames, completionContextFrame{parts: key})
			}
		case '}':
			if len(frames) > 0 {
				frames = frames[:len(frames)-1]
			}
		}
	}
	return frames
}

func flattenCompletionContext(frames []completionContextFrame) []string {
	context := make([]string, 0, len(frames))
	for _, frame := range frames {
		context = append(context, frame.parts...)
	}
	return context
}

func stripD2LineComment(text string) string {
	quote := byte(0)
	for index := 0; index < len(text); index++ {
		char := text[index]
		if quote != 0 {
			if char == '\\' {
				index++
			} else if char == quote {
				quote = 0
			}
			continue
		}
		if char == '"' || char == '\'' {
			quote = char
			continue
		}
		if char == '#' || (char == '/' && index+1 < len(text) && text[index+1] == '/') {
			return text[:index]
		}
	}
	return text
}

func extractD2KeyPath(prefix string) []string {
	end := len(prefix)
	for end > 0 && (prefix[end-1] == ' ' || prefix[end-1] == '\t') {
		end--
	}
	start := end
	for start > 0 {
		char := prefix[start-1]
		if isCompletionValueChar(char) || char == '.' {
			start--
			continue
		}
		break
	}
	if start == end {
		return nil
	}

	parts := strings.Split(prefix[start:end], ".")
	context := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == "" {
			continue
		}
		context = append(context, part)
	}
	return context
}

func hasTrailingContext(context []string, suffix ...string) bool {
	if len(context) < len(suffix) {
		return false
	}
	offset := len(context) - len(suffix)
	for index, part := range suffix {
		if context[offset+index] != part {
			return false
		}
	}
	return true
}

func completionProbeWithoutCurrentValue(source string, line, column int) (string, int) {
	lines := strings.Split(source, "\n")
	if line < 0 || line >= len(lines) {
		return source, column
	}

	lineText := lines[line]
	column = clamp(column, 0, len(lineText))
	start := column
	for start > 0 && isCompletionValueChar(lineText[start-1]) {
		start--
	}
	end := column
	for end < len(lineText) && isCompletionValueChar(lineText[end]) {
		end++
	}
	if start == end {
		return source, column
	}

	prefix := lineText[:start]
	colonIndex := strings.LastIndex(prefix, ":")
	if colonIndex < 0 || strings.TrimSpace(prefix[colonIndex+1:]) != "" {
		return source, column
	}

	lines[line] = lineText[:start] + lineText[end:]
	return strings.Join(lines, "\n"), start
}

func isCompletionValueChar(char byte) bool {
	return char == '-' || char == '_' || (char >= '0' && char <= '9') || (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z')
}

func completionKind(kind d2lsp.CompletionKind) string {
	switch kind {
	case d2lsp.StyleCompletion:
		return "style"
	case d2lsp.ShapeCompletion:
		return "shape"
	default:
		return "keyword"
	}
}

func clamp(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
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
			scanConnectionTokenRanges(out, line, i+1)
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

func scanConnectionTokenRanges(out map[string][]sourceRange, line string, lineNumber int) {
	start := 0
	for {
		segment := line[start:]
		idx := strings.Index(segment, "->")
		if terminator := strings.IndexAny(segment, ":{"); terminator >= 0 && (idx < 0 || terminator < idx) {
			addTokenRange(out, segment[:terminator], lineNumber, start)
			return
		}
		if idx < 0 {
			addTokenRange(out, segment, lineNumber, start)
			return
		}
		arrow := start + idx
		addTokenRange(out, line[start:arrow], lineNumber, start)
		start = arrow + 2
	}
}

func addTokenRange(out map[string][]sourceRange, text string, line int, baseColumn int) {
	if idx := strings.IndexAny(text, ":{"); idx >= 0 {
		text = text[:idx]
	}
	tokenText := text
	if idx := strings.Index(tokenText, "->"); idx >= 0 {
		tokenText = tokenText[:idx]
	}
	token, start, end, ok := sourceTokenRange(tokenText)
	if !ok {
		return
	}
	out[token] = append(out[token], sourceRange{
		File:        "main.d2",
		StartLine:   line,
		StartColumn: baseColumn + start + 1,
		EndLine:     line,
		EndColumn:   baseColumn + end + 1,
	})
}

func sourceTokenRange(text string) (string, int, int, bool) {
	start := firstNonSpaceIndex(text)
	if start >= len(text) {
		return "", 0, 0, false
	}
	if text[start] == '"' || text[start] == '\'' {
		end := quotedTokenEnd(text, start)
		if end <= start+1 {
			return "", 0, 0, false
		}
		return text[start+1 : end], start, end + 1, true
	}

	loc := identifierRE.FindStringIndex(text)
	if loc == nil {
		return "", 0, 0, false
	}
	token := strings.TrimSuffix(strings.TrimSpace(text[loc[0]:loc[1]]), ".")
	if token == "" {
		return "", 0, 0, false
	}
	return token, loc[0], loc[1], true
}

func firstNonSpaceIndex(text string) int {
	for i := 0; i < len(text); i++ {
		switch text[i] {
		case ' ', '\t', '\r', '\n':
			continue
		default:
			return i
		}
	}
	return len(text)
}

func quotedTokenEnd(text string, start int) int {
	quote := text[start]
	escaped := false
	for i := start + 1; i < len(text); i++ {
		if escaped {
			escaped = false
			continue
		}
		if text[i] == '\\' {
			escaped = true
			continue
		}
		if text[i] == quote {
			return i
		}
	}
	return -1
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

package main

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestCompileProducesSVGAndObjects(t *testing.T) {
	result, err := compile(compileParams{Source: "api -> db\napi: API\ndb: Database"})
	if err != nil {
		t.Fatal(err)
	}
	if result.SVG == "" {
		t.Fatal("expected SVG")
	}
	if len(result.Objects) == 0 {
		t.Fatal("expected object map entries")
	}
}

func TestCompileBuildsObjectMapWithSourceRanges(t *testing.T) {
	source := `direction: right

api: API Server {
  shape: hexagon
}

db: Database {
  shape: cylinder
}

api -> db: query`
	result, err := compile(compileParams{Source: source, Layout: "dagre", Theme: 4})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Diagnostics) != 0 {
		t.Fatalf("expected no diagnostics, got %#v", result.Diagnostics)
	}

	api := findObject(result.Objects, "api")
	if api == nil {
		t.Fatal("expected api object")
	}
	if api.Kind != "shape" {
		t.Fatalf("expected api to be shape, got %q", api.Kind)
	}
	if api.Preview.X == nil || api.Preview.Y == nil || api.Preview.Width == nil || api.Preview.Height == nil {
		t.Fatalf("expected api preview bounds, got %#v", api.Preview)
	}
	if len(api.SourceRanges) == 0 {
		t.Fatal("expected api source ranges")
	}
	if api.SourceRanges[0].StartLine != 3 || api.SourceRanges[0].StartColumn != 1 {
		t.Fatalf("unexpected api source range: %#v", api.SourceRanges[0])
	}

	connection := findConnection(result.Objects, "query")
	if connection == nil {
		t.Fatalf("expected api to db connection in %#v", result.Objects)
	}
	if len(connection.Preview.Route) == 0 {
		t.Fatal("expected connection route")
	}
	if len(connection.SourceRanges) < 2 {
		t.Fatalf("expected connection to include source ranges for both endpoints, got %#v", connection.SourceRanges)
	}
}

func TestCompileDoesNotMarshalNullSourceRanges(t *testing.T) {
	result, err := compile(compileParams{Source: "direction: down\n\nhoge -> fuga -> piyo\n", Layout: "dagre", Theme: 4})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), `"sourceRanges":null`) {
		t.Fatalf("expected sourceRanges to marshal as arrays, got %s", encoded)
	}

	fuga := findObject(result.Objects, "fuga")
	if fuga == nil {
		t.Fatal("expected fuga object")
	}
	if len(fuga.SourceRanges) == 0 {
		t.Fatalf("expected chained connection endpoint range for fuga, got %#v", fuga.SourceRanges)
	}

	piyo := findObject(result.Objects, "piyo")
	if piyo == nil {
		t.Fatal("expected piyo object")
	}
	if len(piyo.SourceRanges) == 0 {
		t.Fatalf("expected chained connection endpoint range for piyo, got %#v", piyo.SourceRanges)
	}

	connection := findConnectionByID(result.Objects, "(fuga -> piyo)[0]")
	if connection == nil {
		t.Fatalf("expected fuga to piyo connection in %#v", result.Objects)
	}
	if len(connection.SourceRanges) < 2 {
		t.Fatalf("expected fuga to piyo connection to include both endpoint ranges, got %#v", connection.SourceRanges)
	}
}

func TestCompileMapsBidirectionalNestedParentEndpoint(t *testing.T) {
	source := `direction: right

hoge {
  hoge1
  hoge2
}

hoge <-> fuga -> piyo
`
	result, err := compile(compileParams{Source: source, Layout: "dagre", Theme: 4})
	if err != nil {
		t.Fatal(err)
	}

	hoge := findObject(result.Objects, "hoge")
	if hoge == nil {
		t.Fatalf("expected hoge object in %#v", result.Objects)
	}
	if !hasRange(hoge.SourceRanges, 8, 1, 5) {
		t.Fatalf("expected hoge to include bidirectional endpoint range, got %#v", hoge.SourceRanges)
	}

	cursor := nodeAt(nodeAtParams{Source: source, Line: 8, Column: 2})
	if cursor["id"] != "hoge" {
		t.Fatalf("expected cursor on parent endpoint to focus hoge, got %#v", cursor)
	}
}

func TestCompileMapsQuotedBidirectionalEndpoint(t *testing.T) {
	source := `"foo bar" <-> baz
`
	result, err := compile(compileParams{Source: source, Layout: "dagre", Theme: 4})
	if err != nil {
		t.Fatal(err)
	}

	quoted := findObject(result.Objects, "foo bar")
	if quoted == nil {
		t.Fatalf("expected quoted object in %#v", result.Objects)
	}
	if !hasRange(quoted.SourceRanges, 1, 1, 10) {
		t.Fatalf("expected quoted object to include full quoted endpoint range, got %#v", quoted.SourceRanges)
	}

	cursor := nodeAt(nodeAtParams{Source: source, Line: 1, Column: 6})
	if cursor["id"] != "foo bar" {
		t.Fatalf("expected cursor on quoted endpoint to focus foo bar, got %#v", cursor)
	}
}

func TestScanSourceRangesIgnoresConnectionLabelArrows(t *testing.T) {
	sourceRanges := scanSourceRanges("hoge -> fuga: piyo -> label\npiyo\n")

	piyoRanges := sourceRanges["piyo"]
	if len(piyoRanges) != 1 {
		t.Fatalf("expected only piyo definition range, got %#v", piyoRanges)
	}
	if piyoRanges[0].StartLine != 2 || piyoRanges[0].StartColumn != 1 {
		t.Fatalf("expected piyo definition range, got %#v", piyoRanges[0])
	}
}

func TestCompileReturnsDiagnosticsForInvalidSource(t *testing.T) {
	result, err := compile(compileParams{Source: "api -> {"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Diagnostics) == 0 {
		t.Fatal("expected diagnostics")
	}
	if result.Diagnostics[0].Severity != "error" {
		t.Fatalf("expected error diagnostic, got %#v", result.Diagnostics[0])
	}
	if result.SVG == "" {
		t.Fatal("expected fallback or partial SVG")
	}
}

func TestNodeAtFindsSourceObject(t *testing.T) {
	result := nodeAt(nodeAtParams{Source: "api -> db", Line: 1, Column: 2})
	if result["id"] == "" {
		t.Fatal("expected object id")
	}
}

func TestNodeAtFindsDefinitionsAndConnectionEndpoints(t *testing.T) {
	source := "api: API Server\napi -> db: query\n"

	definition := nodeAt(nodeAtParams{Source: source, Line: 1, Column: 2})
	if definition["id"] != "api" {
		t.Fatalf("expected api at definition, got %#v", definition)
	}

	endpoint := nodeAt(nodeAtParams{Source: source, Line: 2, Column: 9})
	if endpoint["id"] != "db" {
		t.Fatalf("expected db at connection endpoint, got %#v", endpoint)
	}
}

func TestFormatPreservesValidDocument(t *testing.T) {
	formatted, err := format("api: API Server\napi -> db")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(formatted, "api") || !strings.Contains(formatted, "db") {
		t.Fatalf("expected formatted source to preserve identifiers, got %q", formatted)
	}
}

func TestCompleteReturnsDirectionCompletions(t *testing.T) {
	source := "direction: "
	items, err := complete(completeParams{Source: source, Line: 0, Column: len(source)})
	if err != nil {
		t.Fatal(err)
	}
	expectedLabels := []string{"up", "down", "right", "left"}
	if gotLabels := completionLabels(items); strings.Join(gotLabels, ",") != strings.Join(expectedLabels, ",") {
		t.Fatalf("expected direction completion labels %v, got %v", expectedLabels, gotLabels)
	}
	if !hasCompletion(items, "right") {
		t.Fatalf("expected direction completions, got %#v", items)
	}
	if !hasCompletionKind(items, "right", "keyword") {
		t.Fatalf("expected right completion to be a keyword, got %#v", items)
	}

	encoded, err := json.Marshal(items[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"label"`) || strings.Contains(string(encoded), `"Label"`) {
		t.Fatalf("expected lower-case JSON fields, got %s", encoded)
	}
}

func TestCompleteReturnsDirectionCompletionsWhileTypingValue(t *testing.T) {
	source := "direction: r"
	items, err := complete(completeParams{Source: source, Line: 0, Column: len(source)})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletion(items, "right") {
		t.Fatalf("expected direction completions while typing value, got %#v", items)
	}
}

func TestCompleteReturnsShapeCompletions(t *testing.T) {
	source := "shape: "
	items, err := complete(completeParams{Source: source, Line: 0, Column: len(source)})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletion(items, "hexagon") || !hasCompletion(items, "sql_table") {
		t.Fatalf("expected shape completions, got %#v", items)
	}
	if !hasCompletionKind(items, "hexagon", "shape") {
		t.Fatalf("expected hexagon completion to be a shape, got %#v", items)
	}
}

func TestCompleteReturnsShapeCompletionsWhileTypingValue(t *testing.T) {
	source := "shape: he"
	items, err := complete(completeParams{Source: source, Line: 0, Column: len(source)})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletion(items, "hexagon") {
		t.Fatalf("expected shape completions while typing value, got %#v", items)
	}
}

func TestCompleteReturnsNestedShapeCompletions(t *testing.T) {
	source := "api: {\n  shape: he\n}"
	items, err := complete(completeParams{Source: source, Line: 1, Column: len("  shape: he")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletion(items, "hexagon") {
		t.Fatalf("expected nested shape completions while typing value, got %#v", items)
	}
}

func TestCompleteReturnsShapeCompletionsForDotSyntax(t *testing.T) {
	source := "api.shape: he"
	items, err := complete(completeParams{Source: source, Line: 0, Column: len(source)})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletion(items, "hexagon") {
		t.Fatalf("expected dot syntax shape completions while typing value, got %#v", items)
	}
}

func TestCompleteReturnsShapeCompletionsForInlineMap(t *testing.T) {
	source := "api: { shape: he }"
	items, err := complete(completeParams{Source: source, Line: 0, Column: len("api: { shape: he")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletion(items, "hexagon") {
		t.Fatalf("expected inline map shape completions while typing value, got %#v", items)
	}
}

func TestCompleteReturnsKeyCompletions(t *testing.T) {
	source := "dir"
	items, err := complete(completeParams{Source: source, Line: 0, Column: len(source)})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "direction", "direction: ") {
		t.Fatalf("expected direction key completion with colon and space, got %#v", items)
	}
}

func TestCompleteReturnsNestedKeyCompletions(t *testing.T) {
	source := "api: {\n  sh\n}"
	items, err := complete(completeParams{Source: source, Line: 1, Column: len("  sh")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "shape", "shape: ") {
		t.Fatalf("expected nested shape key completion with colon and space, got %#v", items)
	}
}

func TestCompleteDoesNotReturnKeyCompletionsInValuePosition(t *testing.T) {
	source := "label: sh"
	items, err := complete(completeParams{Source: source, Line: 0, Column: len(source)})
	if err != nil {
		t.Fatal(err)
	}
	if hasCompletion(items, "shape") {
		t.Fatalf("expected no key completions in value position, got %#v", items)
	}
}

func TestExportSVGReturnsBase64SVG(t *testing.T) {
	result, err := export(exportParams{Source: "api -> db", Format: "svg", Layout: "dagre", Theme: 4})
	if err != nil {
		t.Fatal(err)
	}
	if result.Format != "svg" {
		t.Fatalf("expected svg format, got %q", result.Format)
	}
	decoded, err := base64.StdEncoding.DecodeString(result.Data)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(decoded), "<svg") {
		t.Fatalf("expected decoded SVG, got %q", string(decoded[:min(len(decoded), 80)]))
	}
}

func TestExportRejectsUnsupportedFormat(t *testing.T) {
	_, err := export(exportParams{Source: "api -> db", Format: "jpg"})
	if err == nil {
		t.Fatal("expected unsupported format error")
	}
}

func findObject(objects []objectMap, id string) *objectMap {
	for i := range objects {
		if objects[i].ID == id {
			return &objects[i]
		}
	}
	return nil
}

func findConnection(objects []objectMap, label string) *objectMap {
	for i := range objects {
		if objects[i].Kind != "connection" {
			continue
		}
		if objects[i].Label == label {
			return &objects[i]
		}
	}
	return nil
}

func findConnectionByID(objects []objectMap, id string) *objectMap {
	for i := range objects {
		if objects[i].Kind == "connection" && objects[i].ID == id {
			return &objects[i]
		}
	}
	return nil
}

func hasRange(ranges []sourceRange, line, startColumn, endColumn int) bool {
	for _, r := range ranges {
		if r.StartLine == line && r.EndLine == line && r.StartColumn == startColumn && r.EndColumn == endColumn {
			return true
		}
	}
	return false
}

func hasCompletion(items []completionItem, label string) bool {
	for _, item := range items {
		if item.Label == label {
			return true
		}
	}
	return false
}

func hasCompletionKind(items []completionItem, label, kind string) bool {
	for _, item := range items {
		if item.Label == label && item.Kind == kind {
			return true
		}
	}
	return false
}

func hasCompletionInsertText(items []completionItem, label, insertText string) bool {
	for _, item := range items {
		if item.Label == label && item.InsertText == insertText {
			return true
		}
	}
	return false
}

func completionLabels(items []completionItem) []string {
	labels := make([]string, 0, len(items))
	for _, item := range items {
		labels = append(labels, item.Label)
	}
	return labels
}

package main

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHandleDispatchesMethods(t *testing.T) {
	tests := []struct {
		name     string
		request  request
		validate func(t *testing.T, result any)
	}{
		{
			name: "compile",
			request: request{
				Method: "compile",
				Params: mustParams(t, compileParams{
					Source: "api -> db",
				}),
			},
			validate: func(t *testing.T, result any) {
				compileResult, ok := result.(compileResult)
				if !ok {
					t.Fatalf("expected compileResult, got %T", result)
				}
				if compileResult.SVG == "" || len(compileResult.Objects) == 0 {
					t.Fatalf("expected compiled SVG and objects, got %#v", compileResult)
				}
			},
		},
		{
			name: "format",
			request: request{
				Method: "format",
				Params: mustParams(t, compileParams{Source: "api: API Server\napi -> db"}),
			},
			validate: func(t *testing.T, result any) {
				formatted, ok := result.(string)
				if !ok {
					t.Fatalf("expected string, got %T", result)
				}
				if !strings.Contains(formatted, "api") || !strings.Contains(formatted, "db") {
					t.Fatalf("expected formatted source to preserve identifiers, got %q", formatted)
				}
			},
		},
		{
			name: "nodeAt",
			request: request{
				Method: "nodeAt",
				Params: mustParams(t, nodeAtParams{Source: "api -> db", Line: 1, Column: 2}),
			},
			validate: func(t *testing.T, result any) {
				node, ok := result.(map[string]string)
				if !ok {
					t.Fatalf("expected node map, got %T", result)
				}
				if node["id"] != "api" {
					t.Fatalf("expected api node, got %#v", node)
				}
			},
		},
		{
			name: "renameNode",
			request: request{
				Method: "renameNode",
				Params: mustParams(t, renameNodeParams{Source: "api -> db\napi: API", ID: "api", NewName: "gateway"}),
			},
			validate: func(t *testing.T, result any) {
				renamed, ok := result.(renameNodeResult)
				if !ok {
					t.Fatalf("expected renameNodeResult, got %T", result)
				}
				if renamed.ID != "gateway" || !strings.Contains(renamed.Source, "gateway -> db") {
					t.Fatalf("expected renamed api references, got %#v", renamed)
				}
			},
		},
		{
			name: "complete",
			request: request{
				Method: "complete",
				Params: mustParams(t, completeParams{
					Source: "direction: ",
					Line:   0,
					Column: len("direction: "),
				}),
			},
			validate: func(t *testing.T, result any) {
				items, ok := result.([]completionItem)
				if !ok {
					t.Fatalf("expected completion items, got %T", result)
				}
				if !hasCompletion(items, "right") {
					t.Fatalf("expected direction completions, got %#v", items)
				}
			},
		},
		{
			name: "semanticTokens",
			request: request{
				Method: "semanticTokens",
				Params: mustParams(t, semanticTokenParams{Source: "api: { style.shadow: true }"}),
			},
			validate: func(t *testing.T, result any) {
				tokens, ok := result.([]semanticToken)
				if !ok {
					t.Fatalf("expected semantic tokens, got %T", result)
				}
				if !hasSemanticToken(tokens, "boolean", 1, 22, 1, 26) {
					t.Fatalf("expected boolean semantic token, got %#v", tokens)
				}
			},
		},
		{
			name: "export",
			request: request{
				Method: "export",
				Params: mustParams(t, exportParams{
					Source: "api -> db",
					Format: "svg",
				}),
			},
			validate: func(t *testing.T, result any) {
				exportResult, ok := result.(exportResult)
				if !ok {
					t.Fatalf("expected exportResult, got %T", result)
				}
				if exportResult.Format != "svg" || exportResult.Data == "" {
					t.Fatalf("expected SVG export, got %#v", exportResult)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := handle(tt.request)
			if err != nil {
				t.Fatal(err)
			}
			tt.validate(t, result)
		})
	}
}

func TestHandleRejectsInvalidRequests(t *testing.T) {
	tests := []struct {
		name    string
		request request
		want    string
	}{
		{
			name:    "unknown method",
			request: request{Method: "missing", Params: json.RawMessage(`{}`)},
			want:    `unknown method "missing"`,
		},
		{
			name:    "malformed params",
			request: request{Method: "compile", Params: json.RawMessage(`{`)},
			want:    "unexpected end of JSON input",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := handle(tt.request)
			if err == nil {
				t.Fatal("expected error")
			}
			if got := err.Error(); !strings.Contains(got, tt.want) {
				t.Fatalf("expected error containing %q, got %q", tt.want, got)
			}
		})
	}
}

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

func TestCompileCanRenderCompositionBoard(t *testing.T) {
	source := `baseA -> baseB

layers: {
  infra: {
    layerX -> layerY
  }
}`
	result, err := compile(compileParams{
		Source:    source,
		BoardPath: []string{"layers", "infra"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Diagnostics) != 0 {
		t.Fatalf("expected no diagnostics, got %#v", result.Diagnostics)
	}
	if !strings.Contains(result.SVG, "layerX") {
		t.Fatalf("expected selected layer SVG, got %q", result.SVG)
	}
	if strings.Contains(result.SVG, "baseA") {
		t.Fatalf("expected selected layer to hide root board, got %q", result.SVG)
	}
	if len(result.Boards) != 2 {
		t.Fatalf("expected root and layer board summaries, got %#v", result.Boards)
	}
	layer := result.Boards[1]
	if layer.Kind != "layers" || layer.Name != "infra" || strings.Join(layer.Path, ".") != "layers.infra" {
		t.Fatalf("unexpected layer board summary: %#v", layer)
	}
	layerX := findObject(result.Objects, "layerX")
	if layerX == nil {
		t.Fatalf("expected layerX object in %#v", result.Objects)
	}
	if strings.Join(layerX.BoardPath, ".") != "layers.infra" {
		t.Fatalf("expected layerX board path, got %#v", layerX.BoardPath)
	}
}

func TestCompileAppliesVarsD2ConfigThemeID(t *testing.T) {
	defaultResult, err := compile(compileParams{Source: "a -> b"})
	if err != nil {
		t.Fatal(err)
	}
	configResult, err := compile(compileParams{Source: "vars: {\n  d2-config: {\n    theme-id: 300\n  }\n}\na -> b"})
	if err != nil {
		t.Fatal(err)
	}
	if len(configResult.Diagnostics) != 0 {
		t.Fatalf("expected no diagnostics, got %#v", configResult.Diagnostics)
	}
	if !strings.Contains(defaultResult.SVG, ".fill-B6{fill:#F7F8FE;}") {
		t.Fatalf("expected default theme fill in SVG")
	}
	if !strings.Contains(configResult.SVG, ".fill-B6{fill:#FFFFFF;}") {
		t.Fatalf("expected theme-id from vars.d2-config to affect SVG")
	}
}

func TestCompileAppliesVarsD2ConfigLayoutEngineELK(t *testing.T) {
	result, err := compile(compileParams{Source: "vars: {\n  d2-config: {\n    layout-engine: elk\n  }\n}\na -> b"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Diagnostics) != 0 {
		t.Fatalf("expected no diagnostics, got %#v", result.Diagnostics)
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
	result, err := compile(compileParams{Source: source})
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
	if !hasRange(connection.SourceRanges, 11, 5, 7) {
		t.Fatalf("expected connection to include arrow operator range, got %#v", connection.SourceRanges)
	}
}

func TestCompileDoesNotMarshalNullSourceRanges(t *testing.T) {
	result, err := compile(compileParams{Source: "direction: down\n\nhoge -> fuga -> piyo\n"})
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
	if !hasRange(connection.SourceRanges, 3, 14, 16) {
		t.Fatalf("expected fuga to piyo connection to include its arrow operator range, got %#v", connection.SourceRanges)
	}
}

func TestCompileMapsRepeatedNestedConnectionOperators(t *testing.T) {
	source := `a: {
  x
  y
  x -> y
}
b: {
  x
  y
  x -> y
}
`
	result, err := compile(compileParams{Source: source})
	if err != nil {
		t.Fatal(err)
	}

	aConnection := findConnectionByID(result.Objects, "a.(x -> y)[0]")
	if aConnection == nil {
		t.Fatalf("expected a.x to a.y connection in %#v", result.Objects)
	}
	if !hasRange(aConnection.SourceRanges, 4, 5, 7) {
		t.Fatalf("expected a.x to a.y connection to include first nested arrow operator range, got %#v", aConnection.SourceRanges)
	}

	bConnection := findConnectionByID(result.Objects, "b.(x -> y)[0]")
	if bConnection == nil {
		t.Fatalf("expected b.x to b.y connection in %#v", result.Objects)
	}
	if !hasRange(bConnection.SourceRanges, 9, 5, 7) {
		t.Fatalf("expected b.x to b.y connection to include second nested arrow operator range, got %#v", bConnection.SourceRanges)
	}
}

func TestCompileMapsNestedConnectionToCompoundEndpoint(t *testing.T) {
	source := `ocpp_server: {
  endpoint
  switcher
  adaptor: {
    1_6
  }

  switcher -> adaptor.1_6
}
`
	result, err := compile(compileParams{Source: source})
	if err != nil {
		t.Fatal(err)
	}

	connection := findConnectionByEndpoints(result.Objects, "ocpp_server.switcher", "ocpp_server.adaptor.1_6")
	if connection == nil {
		t.Fatalf("expected nested switcher to adaptor.1_6 connection in %#v", result.Objects)
	}
	if !hasRange(connection.SourceRanges, 8, 12, 14) {
		t.Fatalf("expected connection to include nested compound endpoint arrow range, got %#v", connection.SourceRanges)
	}

	cursor := nodeAt(nodeAtParams{Source: source, Line: 8, Column: 13})
	if cursor["id"] != connection.ID {
		t.Fatalf("expected cursor on nested compound endpoint arrow to focus connection, got %#v", cursor)
	}
}

func TestCompileMapsRepeatedLabeledConnectionsByOccurrence(t *testing.T) {
	source := `a -> b: first
a -> b: second
`
	result, err := compile(compileParams{Source: source})
	if err != nil {
		t.Fatal(err)
	}

	first := findConnection(result.Objects, "first")
	if first == nil {
		t.Fatalf("expected first labeled connection in %#v", result.Objects)
	}
	second := findConnection(result.Objects, "second")
	if second == nil {
		t.Fatalf("expected second labeled connection in %#v", result.Objects)
	}
	if !containsAny(first.SourceRanges, 1, 9) {
		t.Fatalf("expected first connection to include first label range, got %#v", first.SourceRanges)
	}
	if !containsAny(second.SourceRanges, 2, 9) {
		t.Fatalf("expected second connection to include second label range, got %#v", second.SourceRanges)
	}

	cursor := nodeAt(nodeAtParams{Source: source, Line: 2, Column: 9})
	if cursor["id"] != second.ID {
		t.Fatalf("expected cursor on second repeated connection label to focus second connection, got %#v", cursor)
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
	result, err := compile(compileParams{Source: source})
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

func TestCompileMapsNodeLabelAndBlockBody(t *testing.T) {
	source := `api: API Server {
  style: {
    font-size: 35
    italic: true
  }
}
`
	result, err := compile(compileParams{Source: source})
	if err != nil {
		t.Fatal(err)
	}

	api := findObject(result.Objects, "api")
	if api == nil {
		t.Fatalf("expected api object in %#v", result.Objects)
	}
	labelColumn := strings.Index(source, "API Server") + 1
	if !containsAny(api.SourceRanges, 1, labelColumn) {
		t.Fatalf("expected api range to include label, got %#v", api.SourceRanges)
	}
	if !containsAny(api.SourceRanges, 3, 5) {
		t.Fatalf("expected api range to include block body, got %#v", api.SourceRanges)
	}

	cursor := nodeAt(nodeAtParams{Source: source, Line: 4, Column: 5})
	if cursor["id"] != "api" {
		t.Fatalf("expected cursor in api block to focus api, got %#v", cursor)
	}
}

func TestCompileMapsConnectionLabelAndEndpoints(t *testing.T) {
	source := "api -> ocpp_server: charge\n"
	result, err := compile(compileParams{Source: source})
	if err != nil {
		t.Fatal(err)
	}

	connection := findConnection(result.Objects, "charge")
	if connection == nil {
		t.Fatalf("expected labeled connection in %#v", result.Objects)
	}
	if connection.Src != "api" || connection.Dst != "ocpp_server" {
		t.Fatalf("expected connection endpoints api -> ocpp_server, got %#v", connection)
	}
	labelColumn := strings.Index(source, "charge") + 1
	if !containsAny(connection.SourceRanges, 1, labelColumn) {
		t.Fatalf("expected connection range to include label, got %#v", connection.SourceRanges)
	}

	cursor := nodeAt(nodeAtParams{Source: source, Line: 1, Column: labelColumn})
	if cursor["id"] != connection.ID {
		t.Fatalf("expected cursor on connection label to focus connection, got %#v", cursor)
	}
}

func TestCompileMapsConnectionBlockBody(t *testing.T) {
	source := `api -> db: {
  style.stroke: red
}
`
	result, err := compile(compileParams{Source: source})
	if err != nil {
		t.Fatal(err)
	}

	db := findObject(result.Objects, "db")
	if db == nil {
		t.Fatalf("expected db object in %#v", result.Objects)
	}
	if !hasRange(db.SourceRanges, 1, 8, 10) {
		t.Fatalf("expected db endpoint range in connection block, got %#v", db.SourceRanges)
	}

	connection := findConnectionByEndpoints(result.Objects, "api", "db")
	if connection == nil {
		t.Fatalf("expected api to db connection in %#v", result.Objects)
	}
	if !hasRange(connection.SourceRanges, 1, 5, 7) {
		t.Fatalf("expected connection block to include arrow operator range, got %#v", connection.SourceRanges)
	}
	if !containsAny(connection.SourceRanges, 2, 3) {
		t.Fatalf("expected connection block body to focus connection, got %#v", connection.SourceRanges)
	}

	cursor := nodeAt(nodeAtParams{Source: source, Line: 2, Column: 3})
	if cursor["id"] != connection.ID {
		t.Fatalf("expected cursor in connection block body to focus connection, got %#v", cursor)
	}
}

func TestCompileMapsConnectionPreviewPath(t *testing.T) {
	result, err := compile(compileParams{Source: "api -> db\n"})
	if err != nil {
		t.Fatal(err)
	}

	connection := findConnectionByEndpoints(result.Objects, "api", "db")
	if connection == nil {
		t.Fatalf("expected api to db connection in %#v", result.Objects)
	}
	if connection.Preview.Path == "" {
		t.Fatalf("expected connection preview path, got %#v", connection.Preview)
	}
	if !strings.Contains(connection.Preview.Path, "C ") {
		t.Fatalf("expected connection preview path to preserve D2 curve data, got %q", connection.Preview.Path)
	}
}

func TestCompileMapsQuotedBidirectionalEndpoint(t *testing.T) {
	source := `"foo bar" <-> baz
`
	result, err := compile(compileParams{Source: source})
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
	source := "api\nservice\napi.style.fill-pattern: bogus\n"
	result, err := compile(compileParams{Source: source})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Diagnostics) == 0 {
		t.Fatal("expected diagnostics")
	}
	if result.Diagnostics[0].Severity != "error" {
		t.Fatalf("expected error diagnostic, got %#v", result.Diagnostics[0])
	}
	gotRange := result.Diagnostics[0].SourceRange
	if gotRange.StartLine != 3 || gotRange.StartColumn != 25 || gotRange.EndLine != 3 || gotRange.EndColumn != 30 {
		t.Fatalf("expected diagnostic source range at invalid value, got %#v", gotRange)
	}
	if result.SVG == "" {
		t.Fatal("expected fallback or partial SVG")
	}
}

func TestCompileReturnsDiagnosticsForInvalidSyntax(t *testing.T) {
	result, err := compile(compileParams{Source: "api -> {"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Diagnostics) == 0 {
		t.Fatal("expected diagnostics")
	}
	if !hasDiagnosticRange(result.Diagnostics, 1, 8, 9) {
		t.Fatalf("expected diagnostic source range at unterminated map, got %#v", result.Diagnostics)
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

func TestNodeAtFindsNestedFullIdentifier(t *testing.T) {
	source := `api: API
container: {
  api: Nested API
  api -> db
}
`
	definition := nodeAt(nodeAtParams{Source: source, Line: 3, Column: 4})
	if definition["id"] != "container.api" {
		t.Fatalf("expected nested api definition, got %#v", definition)
	}

	endpoint := nodeAt(nodeAtParams{Source: source, Line: 4, Column: 4})
	if endpoint["id"] != "container.api" {
		t.Fatalf("expected nested api endpoint, got %#v", endpoint)
	}
}

func TestRenameNodeOnlyRenamesMatchingNestedIdentifier(t *testing.T) {
	source := `api: API
api -> db
container: {
  api: Nested API
  api -> db
}
container.api -> audit
`
	result, err := renameNode(renameNodeParams{Source: source, ID: "container.api", NewName: "service"})
	if err != nil {
		t.Fatal(err)
	}

	expected := `api: API
api -> db
container: {
  service: Nested API
  service -> db
}
container.service -> audit
`
	if result.Source != expected {
		t.Fatalf("unexpected renamed source:\n%s", result.Source)
	}
	if result.ID != "container.service" {
		t.Fatalf("expected renamed id, got %q", result.ID)
	}
}

func TestRenameNodeKeepsNestedSameNameWhenRenamingTopLevel(t *testing.T) {
	source := `api: API
api -> db
container: {
  api: Nested API
  api -> db
}
`
	result, err := renameNode(renameNodeParams{Source: source, ID: "api", NewName: "gateway"})
	if err != nil {
		t.Fatal(err)
	}

	expected := `gateway: API
gateway -> db
container: {
  api: Nested API
  api -> db
}
`
	if result.Source != expected {
		t.Fatalf("unexpected renamed source:\n%s", result.Source)
	}
}

func TestRenameNodeRenamesConnectionEndpointWithBlock(t *testing.T) {
	source := `api -> db: {
  style.stroke: red
}
`
	result, err := renameNode(renameNodeParams{Source: source, ID: "db", NewName: "database"})
	if err != nil {
		t.Fatal(err)
	}

	expected := `api -> database: {
  style.stroke: red
}
`
	if result.Source != expected {
		t.Fatalf("unexpected renamed source:\n%s", result.Source)
	}
}

func TestRenameNodeRenamesEdgeReferenceDefinitionEndpoints(t *testing.T) {
	source := `api -> db: query
(api -> db)[0].style.stroke: red
(api -> db)[0]: {
  style.stroke-width: 4
}
`
	result, err := renameNode(renameNodeParams{Source: source, ID: "db", NewName: "database"})
	if err != nil {
		t.Fatal(err)
	}

	expected := `api -> database: query
(api -> database)[0].style.stroke: red
(api -> database)[0]: {
  style.stroke-width: 4
}
`
	if result.Source != expected {
		t.Fatalf("unexpected renamed source:\n%s", result.Source)
	}
}

func TestRenameNodeRejectsInvalidName(t *testing.T) {
	_, err := renameNode(renameNodeParams{Source: "api -> db", ID: "api", NewName: "new.name"})
	if err == nil {
		t.Fatal("expected invalid name error")
	}
	if !strings.Contains(err.Error(), "letters, numbers") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestNodeAtFindsConnectionOperator(t *testing.T) {
	result := nodeAt(nodeAtParams{Source: "api -> db", Line: 1, Column: 6})
	if result["id"] != "(api -> db)[0]" {
		t.Fatalf("expected connection at arrow operator, got %#v", result)
	}
}

func TestNodeAtFindsLeftArrowConnectionOperator(t *testing.T) {
	source := "db <- api: query"
	compiled, err := compile(compileParams{Source: source})
	if err != nil {
		t.Fatal(err)
	}

	connection := findConnection(compiled.Objects, "query")
	if connection == nil {
		t.Fatalf("expected left arrow connection in %#v", compiled.Objects)
	}
	if !hasRange(connection.SourceRanges, 1, 4, 6) {
		t.Fatalf("expected left arrow connection to include arrow operator range, got %#v", connection.SourceRanges)
	}

	result := nodeAt(nodeAtParams{Source: source, Line: 1, Column: 5})
	if result["id"] != connection.ID {
		t.Fatalf("expected connection at left arrow operator, got %#v; connection %#v", result, connection)
	}
}

func TestSelectionRangesReturnNestedSyntaxRanges(t *testing.T) {
	source := `container: {
  api: API Server
  api -> db: query
}
`
	ranges := selectionRangesAt(source, 2, 4)
	if len(ranges) < 4 {
		t.Fatalf("expected nested selection ranges, got %#v", ranges)
	}
	if !equalSourceRange(ranges[0], sourceRange{File: "main.d2", StartLine: 2, StartColumn: 3, EndLine: 2, EndColumn: 6}) {
		t.Fatalf("expected first range to select node token, got %#v", ranges[0])
	}
	if !hasRange(ranges, 2, 3, 18) {
		t.Fatalf("expected node statement range, got %#v", ranges)
	}
	if !hasExactRange(ranges, sourceRange{File: "main.d2", StartLine: 2, StartColumn: 1, EndLine: 4, EndColumn: 1}) {
		t.Fatalf("expected parent block inner range, got %#v", ranges)
	}
	if !hasExactRange(ranges, sourceRange{File: "main.d2", StartLine: 1, StartColumn: 1, EndLine: 4, EndColumn: 2}) {
		t.Fatalf("expected parent block range, got %#v", ranges)
	}
	if !equalSourceRange(ranges[len(ranges)-1], sourceRange{File: "main.d2", StartLine: 1, StartColumn: 1, EndLine: 5, EndColumn: 1}) {
		t.Fatalf("expected full document range last, got %#v", ranges[len(ranges)-1])
	}
}

func TestSelectionRangesIncludeConnectionStatement(t *testing.T) {
	source := `container: {
  api -> db: query
}
`
	ranges := selectionRangesAt(source, 2, 11)
	if len(ranges) < 4 {
		t.Fatalf("expected connection selection ranges, got %#v", ranges)
	}
	if !equalSourceRange(ranges[0], sourceRange{File: "main.d2", StartLine: 2, StartColumn: 10, EndLine: 2, EndColumn: 12}) {
		t.Fatalf("expected first range to select endpoint token, got %#v", ranges[0])
	}
	if !hasRange(ranges, 2, 3, 19) {
		t.Fatalf("expected connection statement range, got %#v", ranges)
	}
	if !hasExactRange(ranges, sourceRange{File: "main.d2", StartLine: 2, StartColumn: 1, EndLine: 3, EndColumn: 1}) {
		t.Fatalf("expected parent block inner range, got %#v", ranges)
	}
	if !hasExactRange(ranges, sourceRange{File: "main.d2", StartLine: 1, StartColumn: 1, EndLine: 3, EndColumn: 2}) {
		t.Fatalf("expected parent block range, got %#v", ranges)
	}
}

func TestSelectionRangesPreferPathSegmentThenStatementAndContainers(t *testing.T) {
	source := `container: {
  api: {
    style.opacity: 0.25
  }
}
`
	ranges := selectionRangesAt(source, 3, 12)
	expected := []sourceRange{
		{File: "main.d2", StartLine: 3, StartColumn: 11, EndLine: 3, EndColumn: 18},
		{File: "main.d2", StartLine: 3, StartColumn: 5, EndLine: 3, EndColumn: 18},
		{File: "main.d2", StartLine: 3, StartColumn: 5, EndLine: 3, EndColumn: 24},
		{File: "main.d2", StartLine: 3, StartColumn: 1, EndLine: 4, EndColumn: 3},
		{File: "main.d2", StartLine: 2, StartColumn: 3, EndLine: 4, EndColumn: 4},
		{File: "main.d2", StartLine: 2, StartColumn: 1, EndLine: 5, EndColumn: 1},
		{File: "main.d2", StartLine: 1, StartColumn: 1, EndLine: 5, EndColumn: 2},
		{File: "main.d2", StartLine: 1, StartColumn: 1, EndLine: 6, EndColumn: 1},
	}
	if len(ranges) < len(expected) {
		t.Fatalf("expected at least %d selection ranges, got %#v", len(expected), ranges)
	}
	for i, want := range expected {
		if !equalSourceRange(ranges[i], want) {
			t.Fatalf("unexpected range %d: got %#v want %#v; all ranges %#v", i, ranges[i], want, ranges)
		}
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

func TestCompleteReturnsLearningDescriptions(t *testing.T) {
	tests := []struct {
		name        string
		source      string
		line        int
		column      int
		label       string
		description string
	}{
		{
			name:        "key",
			source:      "dir",
			line:        0,
			column:      len("dir"),
			label:       "direction",
			description: "全体のレイアウト方向を指定",
		},
		{
			name:        "style key",
			source:      "api: {\n  style: {\n    fill-p\n  }\n}",
			line:        2,
			column:      len("    fill-p"),
			label:       "fill-pattern",
			description: "塗りパターンを指定",
		},
		{
			name:        "value",
			source:      "shape: he",
			line:        0,
			column:      len("shape: he"),
			label:       "hexagon",
			description: "六角形の図形",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			items, err := complete(completeParams{Source: tt.source, Line: tt.line, Column: tt.column})
			if err != nil {
				t.Fatal(err)
			}
			item := completionByLabel(items, tt.label)
			if item == nil {
				t.Fatalf("expected %q completion, got %#v", tt.label, items)
			}
			if item.Description != tt.description {
				t.Fatalf("expected description %q, got %#v", tt.description, item)
			}
			if !strings.Contains(item.Documentation, item.Detail) {
				t.Fatalf("expected documentation to preserve detail %q, got %#v", item.Detail, item)
			}
		})
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

func TestCompleteReturnsTerrastructIconCompletions(t *testing.T) {
	source := "api: { icon: git }"
	items, err := complete(completeParams{Source: source, Line: 0, Column: len("api: { icon: git")})
	if err != nil {
		t.Fatal(err)
	}

	item := completionByLabel(items, "GitHub")
	if item == nil {
		t.Fatalf("expected GitHub icon completion, got %#v", items)
	}
	if item.Kind != "icon" {
		t.Fatalf("expected icon completion kind, got %#v", item)
	}
	if item.InsertText != "https://icons.terrastruct.com/dev%2Fgithub.svg" {
		t.Fatalf("expected Terrastruct GitHub URL insert text, got %#v", item)
	}
	if !strings.Contains(item.FilterText, "repository") {
		t.Fatalf("expected searchable icon aliases, got %#v", item)
	}
}

func TestCompleteReturnsTerrastructIconCompletionsForNestedIcon(t *testing.T) {
	source := "api: {\n  icon: lam\n}"
	items, err := complete(completeParams{Source: source, Line: 1, Column: len("  icon: lam")})
	if err != nil {
		t.Fatal(err)
	}

	item := completionByLabel(items, "AWS Lambda")
	if item == nil {
		t.Fatalf("expected AWS Lambda icon completion, got %#v", items)
	}
	if !strings.Contains(item.InsertText, "aws%2FCompute%2FAWS-Lambda_Lambda-Function_light-bg.svg") {
		t.Fatalf("expected AWS Lambda URL insert text, got %#v", item)
	}
}

func TestCompleteReturnsResolvableGCPBigQueryIconURL(t *testing.T) {
	source := "hoge.icon: gcp"
	items, err := complete(completeParams{Source: source, Line: 0, Column: len(source)})
	if err != nil {
		t.Fatal(err)
	}

	item := completionByLabel(items, "GCP BigQuery")
	if item == nil {
		t.Fatalf("expected GCP BigQuery icon completion, got %#v", items)
	}
	if item.InsertText != "https://icons.terrastruct.com/gcp%2FProducts%20and%20services%2FData%20Analytics%2FBigQuery.svg" {
		t.Fatalf("expected resolvable GCP BigQuery URL insert text, got %#v", item)
	}
}

func TestCompleteReturnsResolvableAWSIAMIconURL(t *testing.T) {
	source := "auth.icon: iam"
	items, err := complete(completeParams{Source: source, Line: 0, Column: len(source)})
	if err != nil {
		t.Fatal(err)
	}

	item := completionByLabel(items, "AWS IAM")
	if item == nil {
		t.Fatalf("expected AWS IAM icon completion, got %#v", items)
	}
	if item.InsertText != "https://icons.terrastruct.com/aws%2FSecurity%2C%20Identity%2C%20&%20Compliance%2FAWS-Identify-and-Access-Management_IAM.svg" {
		t.Fatalf("expected resolvable AWS IAM URL insert text, got %#v", item)
	}
}

func TestCompleteReturnsExpandedKeyCompletions(t *testing.T) {
	source := "source-arr"
	items, err := complete(completeParams{Source: source, Line: 0, Column: len(source)})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "source-arrowhead", "source-arrowhead") {
		t.Fatalf("expected source-arrowhead key completion, got %#v", items)
	}

	source = "api: {\n  grid-c\n}"
	items, err = complete(completeParams{Source: source, Line: 1, Column: len("  grid-c")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "grid-columns", "grid-columns: ") {
		t.Fatalf("expected nested grid-columns key completion, got %#v", items)
	}

	source = "api -> db: { source-arrowhead.la"
	items, err = complete(completeParams{Source: source, Line: 0, Column: len(source)})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "label", "label: ") {
		t.Fatalf("expected arrowhead label key completion with colon, got %#v", items)
	}
}

func TestCompleteReturnsStyleKeyCompletions(t *testing.T) {
	source := "api: {\n  style: {\n    fill-p\n  }\n}"
	items, err := complete(completeParams{Source: source, Line: 2, Column: len("    fill-p")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "fill-pattern", "fill-pattern: ") {
		t.Fatalf("expected fill-pattern key completion, got %#v", items)
	}
}

func TestCompleteScopesStyleKeyCompletionsToStyleMaps(t *testing.T) {
	source := "api: {\n  op\n}"
	items, err := complete(completeParams{Source: source, Line: 1, Column: len("  op")})
	if err != nil {
		t.Fatal(err)
	}
	if hasCompletion(items, "opacity") {
		t.Fatalf("expected no opacity key completion outside style map, got %#v", items)
	}

	source = "api: {\n  style: {\n    op\n  }\n}"
	items, err = complete(completeParams{Source: source, Line: 2, Column: len("    op")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "opacity", "opacity: ") {
		t.Fatalf("expected opacity key completion inside style map, got %#v", items)
	}
}

func TestCompleteDoesNotLeakInlineMapContext(t *testing.T) {
	source := "api: { style: { opacity: 0.5 } }\nop"
	items, err := complete(completeParams{Source: source, Line: 1, Column: len("op")})
	if err != nil {
		t.Fatal(err)
	}
	if hasCompletion(items, "opacity") {
		t.Fatalf("expected no opacity key completion after closed inline style map, got %#v", items)
	}
}

func TestCompleteReturnsNestedConfigKeysForInlineParentMaps(t *testing.T) {
	source := "vars: { d2-config: {\n  theme-\n} }"
	items, err := complete(completeParams{Source: source, Line: 1, Column: len("  theme-")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "theme-id", "theme-id: ") {
		t.Fatalf("expected theme-id config key completion inside inline parent maps, got %#v", items)
	}
}

func TestCompleteReturnsRootVarsKeyCompletions(t *testing.T) {
	source := "vars: {\n  d2-\n}"
	items, err := complete(completeParams{Source: source, Line: 1, Column: len("  d2-")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "d2-config", "d2-config") {
		t.Fatalf("expected d2-config key completion in root vars, got %#v", items)
	}
	if !hasCompletionInsertText(items, "d2-legend", "d2-legend") {
		t.Fatalf("expected d2-legend key completion in root vars, got %#v", items)
	}
}

func TestCompleteOmitsColonForDotContinuableKeys(t *testing.T) {
	tests := []struct {
		name   string
		source string
		label  string
	}{
		{name: "style holder", source: "api: {\n  sty", label: "style"},
		{name: "label composite", source: "api: {\n  lab", label: "label"},
		{name: "root vars", source: "var", label: "vars"},
		{name: "theme overrides", source: "vars: {\n  d2-config: {\n    theme-o", label: "theme-overrides"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			line := strings.Count(tt.source, "\n")
			column := len(tt.source) - strings.LastIndex(tt.source, "\n") - 1
			items, err := complete(completeParams{Source: tt.source, Line: line, Column: column})
			if err != nil {
				t.Fatal(err)
			}
			if !hasCompletionInsertText(items, tt.label, tt.label) {
				t.Fatalf("expected %s key completion without colon, got %#v", tt.label, items)
			}
			if hasCompletionInsertText(items, tt.label, tt.label+": ") {
				t.Fatalf("expected %s key completion not to insert colon, got %#v", tt.label, items)
			}
		})
	}
}

func TestCompleteDoesNotReturnD2ConfigKeyInNestedVars(t *testing.T) {
	source := "api: {\n  vars: {\n    d2-\n  }\n}"
	items, err := complete(completeParams{Source: source, Line: 2, Column: len("    d2-")})
	if err != nil {
		t.Fatal(err)
	}
	if hasCompletion(items, "d2-config") {
		t.Fatalf("expected no d2-config key completion in nested vars, got %#v", items)
	}
	if hasCompletion(items, "d2-legend") {
		t.Fatalf("expected no d2-legend key completion in nested vars, got %#v", items)
	}
}

func TestCompleteIgnoresBracesInStringsAndSlashComments(t *testing.T) {
	source := "vars: {\n  d2-config: {\n    data: \"}\"\n    // }\n    theme-\n  }\n}"
	items, err := complete(completeParams{Source: source, Line: 4, Column: len("    theme-")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "theme-id", "theme-id: ") {
		t.Fatalf("expected theme-id config key completion after string/comment braces, got %#v", items)
	}
}

func TestCompleteReturnsKeyCompletionsForDotSyntaxWithoutTypedPrefix(t *testing.T) {
	source := "api.style."
	items, err := complete(completeParams{Source: source, Line: 0, Column: len(source)})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "opacity", "opacity: ") {
		t.Fatalf("expected style key completion after dot, got %#v", items)
	}
}

func TestCompleteDoesNotCollectStylePropertiesAsChildNodes(t *testing.T) {
	source := "direction: down\napi\napi.style.animated: true\napi.style."
	items, err := complete(completeParams{Source: source, Line: 3, Column: len("api.style.")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "font", "font: ") {
		t.Fatalf("expected style key completions after existing dotted style property, got %#v", items)
	}
	item := completionByLabel(items, "animated")
	if item == nil {
		t.Fatalf("expected animated style completion, got %#v", items)
	}
	if item.Detail != "style property" || item.InsertText != "animated: " {
		t.Fatalf("expected animated to remain a style key completion, got %#v", item)
	}
}

func TestCompleteReturnsChildNodeCompletionsAfterDot(t *testing.T) {
	source := `hoge: {
  hoge1
  hoge2
  style: {
    fill: red
  }
}
hoge.`
	items, err := complete(completeParams{Source: source, Line: 7, Column: len("hoge.")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "hoge1", "hoge1") || !hasCompletionInsertText(items, "hoge2", "hoge2") {
		t.Fatalf("expected child node completions after dot, got %#v", items)
	}
	if hasCompletion(items, "style") || hasCompletion(items, "fill") {
		t.Fatalf("expected reserved property maps to be excluded from child node completions, got %#v", items)
	}
	if hasCompletionInsertText(items, "shape", "shape: ") {
		t.Fatalf("expected child node completions to take priority over property keys, got %#v", items)
	}
}

func TestCompleteReturnsChildNodeCompletionsInConnectionEndpoint(t *testing.T) {
	source := `hoge: {
  hoge1
  hoge2
}
hoge. -> fuga`
	items, err := complete(completeParams{Source: source, Line: 4, Column: len("hoge.")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "hoge1", "hoge1") || !hasCompletionInsertText(items, "hoge2", "hoge2") {
		t.Fatalf("expected child node completions in connection endpoint, got %#v", items)
	}
}

func TestCompleteReturnsChildNodeCompletionsForDotDefinedChildren(t *testing.T) {
	source := `hoge.hoge1
hoge.hoge2
hoge.`
	items, err := complete(completeParams{Source: source, Line: 2, Column: len("hoge.")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "hoge1", "hoge1") || !hasCompletionInsertText(items, "hoge2", "hoge2") {
		t.Fatalf("expected dot-defined child node completions after dot, got %#v", items)
	}
}

func TestCompleteReturnsTopLevelNodeCompletions(t *testing.T) {
	source := `hoge: {
  hoge1
  hoge2
}
ho`
	items, err := complete(completeParams{Source: source, Line: 4, Column: len("ho")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "hoge", "hoge") {
		t.Fatalf("expected top-level node completion, got %#v", items)
	}
	if !hasCompletionInsertText(items, "horizontal-gap", "horizontal-gap: ") {
		t.Fatalf("expected existing key completions to remain, got %#v", items)
	}
}

func TestCompleteReturnsTopLevelNodeCompletionsInConnectionEndpoint(t *testing.T) {
	source := `hoge: {
  hoge1
  hoge2
}
fuga -> ho`
	items, err := complete(completeParams{Source: source, Line: 4, Column: len("fuga -> ho")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "hoge", "hoge") {
		t.Fatalf("expected top-level node completion in connection endpoint, got %#v", items)
	}
	if hasCompletionInsertText(items, "horizontal-gap", "horizontal-gap: ") {
		t.Fatalf("expected connection endpoint completion to exclude property keys, got %#v", items)
	}
}

func TestCompleteReturnsTopLevelNodeCompletionsInReverseConnectionEndpoint(t *testing.T) {
	source := `hoge: {
  hoge1
  hoge2
}
fuga <- ho`
	items, err := complete(completeParams{Source: source, Line: 4, Column: len("fuga <- ho")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "hoge", "hoge") {
		t.Fatalf("expected top-level node completion in reverse connection endpoint, got %#v", items)
	}
	if hasCompletionInsertText(items, "horizontal-gap", "horizontal-gap: ") {
		t.Fatalf("expected reverse connection endpoint completion to exclude property keys, got %#v", items)
	}
}

func TestCompleteCollectsTopLevelNodesFromReverseConnections(t *testing.T) {
	source := `alpha <- beta
al`
	items, err := complete(completeParams{Source: source, Line: 1, Column: len("al")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "alpha", "alpha") {
		t.Fatalf("expected source endpoint from reverse connection to be collected, got %#v", items)
	}
}

func TestCompleteFiltersChildNodeCompletionsWhileTyping(t *testing.T) {
	source := `hoge: {
  alpha
  beta
}
hoge.a`
	items, err := complete(completeParams{Source: source, Line: 4, Column: len("hoge.a")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "alpha", "alpha") {
		t.Fatalf("expected matching child node completion, got %#v", items)
	}
	if hasCompletion(items, "beta") {
		t.Fatalf("expected non-matching child node to be filtered, got %#v", items)
	}
}

func TestCompleteReturnsDeepChildNodeCompletionsAfterDot(t *testing.T) {
	source := `hoge: {
  hoge1: {
    piyo
  }
}
hoge.hoge1.`
	items, err := complete(completeParams{Source: source, Line: 5, Column: len("hoge.hoge1.")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "piyo", "piyo") {
		t.Fatalf("expected deep child node completion after dot, got %#v", items)
	}
}

func TestCompleteReturnsRelativeNestedChildNodeCompletionsAfterDot(t *testing.T) {
	source := `ocpp_server: OCPP サーバー {
  endpoint: エンドポイント
  adaptor: {
    1_6: OCPP1.6
    2: OCPP2.0.1
  }

  endpoint.`
	items, err := complete(completeParams{Source: source, Line: 7, Column: len("  endpoint.")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "adaptor", "adaptor") {
		t.Fatalf("expected relative nested child node completion after dot, got %#v", items)
	}
}

func TestCompleteDoesNotReturnSiblingNodeCompletionsForUnknownRelativeNodeAfterDot(t *testing.T) {
	tests := []struct {
		name   string
		source string
	}{
		{
			name: "unknown node",
			source: `ocpp_server: OCPP サーバー {
  endpoint: エンドポイント
  adaptor: {
    1_6: OCPP1.6
    2: OCPP2.0.1
  }

  unknown.`,
		},
		{
			name: "reserved property",
			source: `ocpp_server: OCPP サーバー {
  endpoint: エンドポイント
  adaptor: {
    1_6: OCPP1.6
    2: OCPP2.0.1
  }

  shape.`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			items, err := complete(completeParams{Source: tt.source, Line: 7, Column: len(tt.source) - strings.LastIndex(tt.source, "\n") - 1})
			if err != nil {
				t.Fatal(err)
			}
			if hasCompletion(items, "endpoint") || hasCompletion(items, "adaptor") {
				t.Fatalf("expected no sibling node completions for unknown relative node after dot, got %#v", items)
			}
		})
	}
}

func TestCompleteReturnsInlineMapKeyCompletionsAfterCompletedValue(t *testing.T) {
	source := "api: { label: hello; sh }"
	items, err := complete(completeParams{Source: source, Line: 0, Column: len("api: { label: hello; sh")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "shape", "shape: ") {
		t.Fatalf("expected shape key completion after completed inline value, got %#v", items)
	}
}

func TestCompleteReturnsAdditionalValueCompletions(t *testing.T) {
	tests := []struct {
		name   string
		source string
		line   int
		column int
		label  string
	}{
		{
			name:   "style fill pattern",
			source: "api: { style.fill-pattern: l }",
			line:   0,
			column: len("api: { style.fill-pattern: l"),
			label:  "lines",
		},
		{
			name:   "style boolean",
			source: "api: { style.shadow: t }",
			line:   0,
			column: len("api: { style.shadow: t"),
			label:  "true",
		},
		{
			name:   "arrowhead shape",
			source: "api -> db: { source-arrowhead.shape: c }",
			line:   0,
			column: len("api -> db: { source-arrowhead.shape: c"),
			label:  "cross",
		},
		{
			name:   "font",
			source: "api: { style.font: m }",
			line:   0,
			column: len("api: { style.font: m"),
			label:  "mono",
		},
		{
			name:   "root config boolean",
			source: "vars: {\n  d2-config: {\n    sketch: t\n  }\n}",
			line:   2,
			column: len("    sketch: t"),
			label:  "true",
		},
		{
			name:   "root config light theme id",
			source: "vars: {\n  d2-config: {\n    theme-id: \n  }\n}",
			line:   2,
			column: len("    theme-id: "),
			label:  "6",
		},
		{
			name:   "root config dark theme id",
			source: "vars: {\n  d2-config: {\n    dark-theme-id: \n  }\n}",
			line:   2,
			column: len("    dark-theme-id: "),
			label:  "200",
		},
		{
			name:   "near constant",
			source: "api: { near: top }",
			line:   0,
			column: len("api: { near: top"),
			label:  "top-center",
		},
		{
			name:   "tooltip near constant",
			source: "api: { tooltip.near: top }",
			line:   0,
			column: len("api: { tooltip.near: top"),
			label:  "top-center",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			items, err := complete(completeParams{Source: tt.source, Line: tt.line, Column: tt.column})
			if err != nil {
				t.Fatal(err)
			}
			if !hasCompletion(items, tt.label) {
				t.Fatalf("expected %q completion, got %#v", tt.label, items)
			}
		})
	}
}

func TestSemanticTokensReturnsOnlyBooleanTypedValues(t *testing.T) {
	source := "true: label\napi: true\nhoge: { hoge: true }\napi: { style.shadow: true; label: \"false\" }\nvars: { d2-config: { sketch: false } }"
	tokens, err := semanticTokens(semanticTokenParams{Source: source})
	if err != nil {
		t.Fatal(err)
	}

	if len(tokens) != 2 {
		t.Fatalf("expected 2 boolean tokens, got %#v", tokens)
	}
	if !hasSemanticToken(tokens, "boolean", 4, 22, 4, 26) {
		t.Fatalf("expected style.shadow true token, got %#v", tokens)
	}
	if !hasSemanticToken(tokens, "boolean", 5, 30, 5, 35) {
		t.Fatalf("expected sketch false token, got %#v", tokens)
	}
}

func TestCompleteReturnsThemeMetadata(t *testing.T) {
	source := "vars: {\n  d2-config: {\n    theme-id: \n  }\n}"
	items, err := complete(completeParams{Source: source, Line: 2, Column: len("    theme-id: ")})
	if err != nil {
		t.Fatal(err)
	}
	item := completionByLabel(items, "6")
	if item == nil {
		t.Fatalf("expected Grape Soda theme completion, got %#v", items)
	}
	if item.InsertText != "6" {
		t.Fatalf("expected theme completion to insert id, got %#v", item)
	}
	if item.Description != "Grape Soda" {
		t.Fatalf("expected theme name description, got %#v", item)
	}
	if !strings.Contains(item.FilterText, "Grape Soda") {
		t.Fatalf("expected theme filter text to include name, got %#v", item)
	}
	if len(item.ColorSwatches) == 0 || item.ColorSwatches[0] != "#170034" {
		t.Fatalf("expected Grape Soda color swatches, got %#v", item)
	}
	if !strings.Contains(item.Documentation, "#170034") {
		t.Fatalf("expected theme documentation to include palette, got %#v", item)
	}
}

func TestCompleteExcludesHeavyThemeFromThemeSuggestions(t *testing.T) {
	for _, tt := range []struct {
		name   string
		source string
		line   int
		column int
	}{
		{
			name:   "light theme",
			source: "vars: {\n  d2-config: {\n    theme-id: \n  }\n}",
			line:   2,
			column: len("    theme-id: "),
		},
		{
			name:   "dark theme",
			source: "vars: {\n  d2-config: {\n    dark-theme-id: \n  }\n}",
			line:   2,
			column: len("    dark-theme-id: "),
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			items, err := complete(completeParams{Source: tt.source, Line: tt.line, Column: tt.column})
			if err != nil {
				t.Fatal(err)
			}
			if hasCompletion(items, "302") {
				t.Fatalf("expected theme 302 to be excluded from suggestions, got %#v", items)
			}
		})
	}
}

func TestCompleteDoesNotReturnLabelOnlyPositionsForTooltipNear(t *testing.T) {
	source := "api: { tooltip.near: outside }"
	items, err := complete(completeParams{Source: source, Line: 0, Column: len("api: { tooltip.near: outside")})
	if err != nil {
		t.Fatal(err)
	}
	if hasCompletion(items, "outside-top-left") {
		t.Fatalf("expected no label-only position for tooltip near, got %#v", items)
	}
}

func TestCompleteReturnsConfigKeyCompletions(t *testing.T) {
	source := "vars: {\n  d2-config: {\n    theme-\n  }\n}"
	items, err := complete(completeParams{Source: source, Line: 2, Column: len("    theme-")})
	if err != nil {
		t.Fatal(err)
	}
	if !hasCompletionInsertText(items, "theme-id", "theme-id: ") {
		t.Fatalf("expected theme-id config key completion, got %#v", items)
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

func TestCompileResolvesWorkspaceImports(t *testing.T) {
	workspace := t.TempDir()
	if err := os.WriteFile(filepath.Join(workspace, "components.d2"), []byte("service: {\n  api\n  db\n}\n"), 0644); err != nil {
		t.Fatal(err)
	}

	result, err := compile(compileParams{
		Source:            "...@components",
		WorkspaceRootPath: workspace,
		CurrentFilePath:   filepath.Join(workspace, "diagram.d2"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Diagnostics) != 0 {
		t.Fatalf("expected imported file to compile, got %#v", result.Diagnostics)
	}
	if findObject(result.Objects, "service.api") == nil || findObject(result.Objects, "service.db") == nil {
		t.Fatalf("expected imported objects in object map, got %#v", result.Objects)
	}
}

func TestCompilePrefersOpenImportFileContents(t *testing.T) {
	workspace := t.TempDir()
	componentsPath := filepath.Join(workspace, "components.d2")
	if err := os.WriteFile(componentsPath, []byte("service: {\n  disk\n}\n"), 0644); err != nil {
		t.Fatal(err)
	}

	result, err := compile(compileParams{
		Source:            "...@components",
		WorkspaceRootPath: workspace,
		CurrentFilePath:   filepath.Join(workspace, "diagram.d2"),
		OpenFiles: []compileFile{{
			Path:   componentsPath,
			Source: "service: {\n  memory\n}\n",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Diagnostics) != 0 {
		t.Fatalf("expected open import file to compile, got %#v", result.Diagnostics)
	}
	if findObject(result.Objects, "service.memory") == nil {
		t.Fatalf("expected open file object in object map, got %#v", result.Objects)
	}
	if findObject(result.Objects, "service.disk") != nil {
		t.Fatalf("expected open file contents to override disk contents, got %#v", result.Objects)
	}
}

func TestExportSVGReturnsBase64SVG(t *testing.T) {
	result, err := export(exportParams{Source: "api -> db", Format: "svg"})
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

func findConnectionByEndpoints(objects []objectMap, src, dst string) *objectMap {
	for i := range objects {
		if objects[i].Kind == "connection" && objects[i].Src == src && objects[i].Dst == dst {
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

func equalSourceRange(left, right sourceRange) bool {
	return left.File == right.File &&
		left.StartLine == right.StartLine &&
		left.StartColumn == right.StartColumn &&
		left.EndLine == right.EndLine &&
		left.EndColumn == right.EndColumn
}

func hasExactRange(ranges []sourceRange, expected sourceRange) bool {
	for _, r := range ranges {
		if equalSourceRange(r, expected) {
			return true
		}
	}
	return false
}

func containsAny(ranges []sourceRange, line, column int) bool {
	for _, r := range ranges {
		if contains(r, line, column) {
			return true
		}
	}
	return false
}

func hasDiagnosticRange(diagnostics []diagnostic, line, startColumn, endColumn int) bool {
	for _, diagnostic := range diagnostics {
		r := diagnostic.SourceRange
		if r.StartLine == line && r.EndLine == line && r.StartColumn == startColumn && r.EndColumn == endColumn {
			return true
		}
	}
	return false
}

func hasCompletion(items []completionItem, label string) bool {
	return completionByLabel(items, label) != nil
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

func hasSemanticToken(tokens []semanticToken, tokenType string, line, startColumn, endLine, endColumn int) bool {
	for _, token := range tokens {
		if token.TokenType == tokenType &&
			token.SourceRange.StartLine == line &&
			token.SourceRange.StartColumn == startColumn &&
			token.SourceRange.EndLine == endLine &&
			token.SourceRange.EndColumn == endColumn {
			return true
		}
	}
	return false
}

func completionByLabel(items []completionItem, label string) *completionItem {
	for i := range items {
		if items[i].Label == label {
			return &items[i]
		}
	}
	return nil
}

func completionLabels(items []completionItem) []string {
	labels := make([]string, 0, len(items))
	for _, item := range items {
		labels = append(labels, item.Label)
	}
	return labels
}

func mustParams(t *testing.T, params any) json.RawMessage {
	t.Helper()
	encoded, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

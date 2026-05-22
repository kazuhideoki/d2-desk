package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"oss.terrastruct.com/d2/d2ast"
	"oss.terrastruct.com/d2/d2format"
	"oss.terrastruct.com/d2/d2graph"
	"oss.terrastruct.com/d2/d2layouts/d2dagrelayout"
	"oss.terrastruct.com/d2/d2layouts/d2elklayout"
	"oss.terrastruct.com/d2/d2lib"
	"oss.terrastruct.com/d2/d2parser"
	"oss.terrastruct.com/d2/d2renderers/d2svg"
	"oss.terrastruct.com/d2/d2target"
	"oss.terrastruct.com/d2/lib/log"
	"oss.terrastruct.com/d2/lib/textmeasure"
)

func compile(params compileParams) (compileResult, error) {
	compileContext := newCompileContext(params.WorkspaceRootPath, params.CurrentFilePath, params.OpenFiles)
	previewPad := int64(16)
	renderOpts := &d2svg.RenderOpts{Pad: &previewPad}
	rootDiagram, err := compileDiagram(params.Source, compileContext, renderOpts)
	targetDiagram := rootDiagram
	targetBoardPath := nonNilBoardPath(params.BoardPath)
	if rootDiagram != nil && len(targetBoardPath) > 0 {
		if selectedDiagram := rootDiagram.GetBoard(targetBoardPath); selectedDiagram != nil {
			targetDiagram = selectedDiagram
		} else {
			targetBoardPath = []string{}
		}
	}
	var svg []byte
	var renderErr error
	if targetDiagram != nil {
		svg, renderErr = d2svg.Render(targetDiagram, renderOpts)
	}
	err = errors.Join(err, renderErr)
	result := compileResult{
		SVG:         string(svg),
		Objects:     buildObjectMap(params.Source, targetDiagram, targetBoardPath),
		Boards:      buildBoardSummaries(rootDiagram),
		Diagnostics: []diagnostic{},
	}
	if err != nil {
		result.Diagnostics = diagnosticsFromError(err, params.Source)
		if len(svg) == 0 {
			result.SVG = fallbackSVG(err.Error())
		}
	}
	return result, nil
}

func buildBoardSummaries(diagram *d2target.Diagram) []boardSummary {
	if diagram == nil {
		return []boardSummary{{Path: []string{}, Kind: "root", Name: "root", Label: "Root", Depth: 0}}
	}
	boards := []boardSummary{{Path: []string{}, Kind: "root", Name: "root", Label: "Root", Depth: 0}}
	appendChildBoards(&boards, diagram, nil, 0)
	return boards
}

func appendChildBoards(boards *[]boardSummary, diagram *d2target.Diagram, parentPath []string, parentDepth int) {
	for _, child := range diagram.Layers {
		appendBoardSummary(boards, child, parentPath, "layers", parentDepth+1)
	}
	for _, child := range diagram.Scenarios {
		appendBoardSummary(boards, child, parentPath, "scenarios", parentDepth+1)
	}
	for _, child := range diagram.Steps {
		appendBoardSummary(boards, child, parentPath, "steps", parentDepth+1)
	}
}

func appendBoardSummary(boards *[]boardSummary, diagram *d2target.Diagram, parentPath []string, kind string, depth int) {
	if diagram == nil {
		return
	}
	path := append(append([]string{}, parentPath...), kind, diagram.Name)
	label := diagram.Name
	if diagram.Root.Label != "" && diagram.Root.Label != diagram.Name {
		label = diagram.Root.Label
	}
	*boards = append(*boards, boardSummary{
		Path:  path,
		Kind:  kind,
		Name:  diagram.Name,
		Label: label,
		Depth: depth,
	})
	appendChildBoards(boards, diagram, path, depth)
}

func diagnosticsFromError(err error, source string) []diagnostic {
	var parseErr *d2parser.ParseError
	if errors.As(err, &parseErr) && len(parseErr.Errors) > 0 {
		diagnostics := make([]diagnostic, 0, len(parseErr.Errors))
		for _, parseDiagnostic := range parseErr.Errors {
			diagnostics = append(diagnostics, diagnosticFromD2Error(parseDiagnostic, source))
		}
		return diagnostics
	}

	var astErr d2ast.Error
	if errors.As(err, &astErr) {
		return []diagnostic{diagnosticFromD2Error(astErr, source)}
	}

	return []diagnostic{{
		Message:     err.Error(),
		Severity:    "error",
		SourceRange: fallbackSourceRange(source),
	}}
}

func diagnosticFromD2Error(err d2ast.Error, source string) diagnostic {
	return diagnostic{
		Message:     err.Message,
		Severity:    "error",
		SourceRange: sourceRangeFromD2Range(err.Range, source),
	}
}

func sourceRangeFromD2Range(r d2ast.Range, source string) sourceRange {
	file := r.Path
	if file == "" {
		file = "main.d2"
	}

	return normalizeSourceRange(sourceRange{
		File:        file,
		StartLine:   r.Start.Line + 1,
		StartColumn: r.Start.Column + 1,
		EndLine:     r.End.Line + 1,
		EndColumn:   r.End.Column + 1,
	}, source)
}

func fallbackSourceRange(source string) sourceRange {
	return normalizeSourceRange(sourceRange{
		File:        "main.d2",
		StartLine:   1,
		StartColumn: 1,
		EndLine:     1,
		EndColumn:   1,
	}, source)
}

func normalizeSourceRange(r sourceRange, source string) sourceRange {
	lines := strings.Split(source, "\n")
	if len(lines) == 0 {
		lines = []string{""}
	}

	r.StartLine = clampInt(r.StartLine, 1, len(lines))
	r.EndLine = clampInt(r.EndLine, 1, len(lines))
	if r.EndLine < r.StartLine {
		r.EndLine = r.StartLine
	}

	startMaxColumn := utf16ColumnCount(lines[r.StartLine-1]) + 1
	endMaxColumn := utf16ColumnCount(lines[r.EndLine-1]) + 1
	r.StartColumn = clampInt(r.StartColumn, 1, startMaxColumn)
	r.EndColumn = clampInt(r.EndColumn, 1, endMaxColumn)

	if r.StartLine == r.EndLine && r.EndColumn <= r.StartColumn {
		if r.StartColumn < startMaxColumn {
			r.EndColumn = r.StartColumn + 1
		} else if r.StartColumn > 1 {
			r.StartColumn--
			r.EndColumn = startMaxColumn
		}
	}

	return r
}

func clampInt(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func utf16ColumnCount(text string) int {
	count := 0
	for _, r := range text {
		if r > 0xFFFF {
			count += 2
		} else {
			count++
		}
	}
	return count
}

func render(source string, compileContext compileContext, renderOpts *d2svg.RenderOpts) (*d2target.Diagram, []byte, error) {
	diagram, err := compileDiagram(source, compileContext, renderOpts)
	if diagram == nil {
		return nil, nil, err
	}
	svg, renderErr := d2svg.Render(diagram, renderOpts)
	return diagram, svg, errors.Join(err, renderErr)
}

func compileDiagram(source string, compileContext compileContext, renderOpts *d2svg.RenderOpts) (*d2target.Diagram, error) {
	ruler, err := textmeasure.NewRuler()
	if err != nil {
		return nil, err
	}
	if renderOpts == nil {
		renderOpts = &d2svg.RenderOpts{}
	}
	layoutResolver := func(engine string) (d2graph.LayoutGraph, error) {
		switch engine {
		case "", "dagre":
			return d2dagrelayout.DefaultLayout, nil
		case "elk":
			return d2elklayout.DefaultLayout, nil
		default:
			return nil, fmt.Errorf("layout %q is not bundled", engine)
		}
	}
	compileOpts := &d2lib.CompileOptions{
		LayoutResolver: layoutResolver,
		Ruler:          ruler,
		UTF16Pos:       true,
		InputPath:      compileContext.inputPath,
		FS:             compileContext.fs,
	}
	ctx := log.WithDefault(context.Background())
	diagram, _, err := d2lib.Compile(ctx, source, compileOpts, renderOpts)
	if diagram == nil {
		return nil, err
	}
	return diagram, err
}

func format(source string) (string, error) {
	ast, err := d2lib.Parse(log.WithDefault(context.Background()), source, &d2lib.CompileOptions{UTF16Pos: true})
	if err != nil && ast == nil {
		return "", err
	}
	return d2format.Format(ast), nil
}

func export(params exportParams) (exportResult, error) {
	compileContext := newCompileContext(params.WorkspaceRootPath, params.CurrentFilePath, params.OpenFiles)
	_, svg, err := render(params.Source, compileContext, nil)
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

func fallbackSVG(message string) string {
	var escaped bytes.Buffer
	json.HTMLEscape(&escaped, []byte(message))
	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#fff7ed"/><text x="28" y="42" fill="#9a3412" font-family="monospace" font-size="16">D2 compile error</text><text x="28" y="76" fill="#431407" font-family="monospace" font-size="13">%s</text></svg>`, escaped.String())
}

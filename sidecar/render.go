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
	"oss.terrastruct.com/d2/d2lib"
	"oss.terrastruct.com/d2/d2parser"
	"oss.terrastruct.com/d2/d2renderers/d2svg"
	"oss.terrastruct.com/d2/d2target"
	"oss.terrastruct.com/d2/lib/log"
	"oss.terrastruct.com/d2/lib/textmeasure"
	"oss.terrastruct.com/util-go/go2"
)

func compile(params compileParams) (compileResult, error) {
	compileContext := newCompileContext(params.WorkspaceRootPath, params.CurrentFilePath, params.OpenFiles)
	diagram, svg, err := render(params.Source, params.Layout, params.Theme, compileContext)
	result := compileResult{
		SVG:         string(svg),
		Objects:     buildObjectMap(params.Source, diagram),
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

func render(source, layout string, theme int64, compileContext compileContext) (*d2target.Diagram, []byte, error) {
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
		InputPath:      compileContext.inputPath,
		FS:             compileContext.fs,
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
	compileContext := newCompileContext(params.WorkspaceRootPath, params.CurrentFilePath, params.OpenFiles)
	_, svg, err := render(params.Source, params.Layout, params.Theme, compileContext)
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

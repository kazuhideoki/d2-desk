package main

import (
	"fmt"
	"sort"
	"strings"
)

type nodeDeclaration struct {
	ID       string
	ParentID string
	Context  []string
	Path     []string
	Range    sourceRange
}

type nodeOccurrence struct {
	ID      string
	Context []string
	Range   sourceRange
}

type sourceEdit struct {
	Start       int
	End         int
	Replacement string
}

func addParentNode(params addParentNodeParams) (addParentNodeResult, error) {
	parentName := strings.TrimSpace(params.ParentName)
	if parentName == "" {
		return addParentNodeResult{}, fmt.Errorf("parent name cannot be empty")
	}
	if !renameIdentifierRE.MatchString(parentName) {
		return addParentNodeResult{}, fmt.Errorf("parent name must contain only letters, numbers, underscores, or hyphens")
	}
	if isD2ReservedNodeKey(parentName) {
		return addParentNodeResult{}, fmt.Errorf("%q is reserved", parentName)
	}

	targetIDs, err := normalizeAddParentTargetIDs(params.IDs)
	if err != nil {
		return addParentNodeResult{}, err
	}

	declarations := scanNodeDeclarations(params.Source)
	selectedDeclarations, err := selectedNodeDeclarations(declarations, targetIDs)
	if err != nil {
		return addParentNodeResult{}, err
	}

	parentID := selectedDeclarations[0].ParentID
	for _, declaration := range selectedDeclarations[1:] {
		if declaration.ParentID != parentID {
			return addParentNodeResult{}, fmt.Errorf("selected nodes must share the same parent scope")
		}
	}

	newParentID := joinD2ID(parentID, parentName)
	existingIDs := scanSourceRanges(params.Source)
	if _, ok := existingIDs[newParentID]; ok {
		return addParentNodeResult{}, fmt.Errorf("node %q already exists", newParentID)
	}

	renamedRoots := map[string]string{}
	nextIDs := make([]string, 0, len(selectedDeclarations))
	for _, declaration := range selectedDeclarations {
		if len(declaration.Path) != 1 {
			return addParentNodeResult{}, fmt.Errorf("add parent supports nodes declared as direct children of the same block")
		}
		nextID := joinD2ID(newParentID, declaration.Path[0])
		if conflictsWithExistingMovedNode(nextID, targetIDs, existingIDs) {
			return addParentNodeResult{}, fmt.Errorf("node %q already exists", nextID)
		}
		renamedRoots[declaration.ID] = nextID
		nextIDs = append(nextIDs, nextID)
	}

	edits, err := addParentDeclarationEdits(params.Source, selectedDeclarations, parentName)
	if err != nil {
		return addParentNodeResult{}, err
	}

	movedLineRanges := declarationLineRanges(selectedDeclarations)
	for _, occurrence := range scanNodeOccurrences(params.Source, false) {
		if sourceRangeOverlapsAnyLineRange(occurrence.Range, movedLineRanges) {
			continue
		}
		nextID, ok := remapMovedNodeID(occurrence.ID, renamedRoots)
		if !ok {
			continue
		}
		start, end, err := sourceRangeOffsets(params.Source, occurrence.Range)
		if err != nil {
			return addParentNodeResult{}, err
		}
		edits = append(edits, sourceEdit{
			Start:       start,
			End:         end,
			Replacement: relativeD2ID(nextID, occurrence.Context),
		})
	}

	nextSource, err := applySourceEdits(params.Source, edits)
	if err != nil {
		return addParentNodeResult{}, err
	}
	return addParentNodeResult{Source: nextSource, IDs: nextIDs, ParentID: newParentID}, nil
}

func normalizeAddParentTargetIDs(ids []string) ([]string, error) {
	seen := map[string]struct{}{}
	out := []string{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("select a node to add a parent")
	}
	sort.Strings(out)
	return removeDescendantIDs(out), nil
}

func removeDescendantIDs(ids []string) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		hasAncestor := false
		for _, other := range ids {
			if other == id {
				continue
			}
			if idHasPrefix(id, other) {
				hasAncestor = true
				break
			}
		}
		if !hasAncestor {
			out = append(out, id)
		}
	}
	return out
}

func selectedNodeDeclarations(declarations []nodeDeclaration, targetIDs []string) ([]nodeDeclaration, error) {
	byID := map[string][]nodeDeclaration{}
	for _, declaration := range declarations {
		byID[declaration.ID] = append(byID[declaration.ID], declaration)
	}

	selected := make([]nodeDeclaration, 0, len(targetIDs))
	for _, id := range targetIDs {
		matches := byID[id]
		if len(matches) == 0 {
			return nil, fmt.Errorf("node %q was not found in source", id)
		}
		if len(matches) > 1 {
			return nil, fmt.Errorf("node %q has multiple declarations; select a single declaration first", id)
		}
		selected = append(selected, matches[0])
	}
	sort.SliceStable(selected, func(i, j int) bool {
		if selected[i].Range.StartLine == selected[j].Range.StartLine {
			return selected[i].Range.StartColumn < selected[j].Range.StartColumn
		}
		return selected[i].Range.StartLine < selected[j].Range.StartLine
	})
	return selected, nil
}

func conflictsWithExistingMovedNode(nextID string, targetIDs []string, existingIDs map[string][]sourceRange) bool {
	for existingID := range existingIDs {
		if !idHasPrefix(existingID, nextID) {
			continue
		}
		moved := false
		for _, targetID := range targetIDs {
			if idHasPrefix(existingID, targetID) {
				moved = true
				break
			}
		}
		if !moved {
			return true
		}
	}
	return false
}

func addParentDeclarationEdits(source string, declarations []nodeDeclaration, parentName string) ([]sourceEdit, error) {
	if len(declarations) == 0 {
		return nil, fmt.Errorf("select a node to add a parent")
	}

	lineRanges := declarationLineRanges(declarations)
	firstRange := lineRanges[0]
	baseIndent, err := lineIndent(source, declarations[0].Range.StartLine)
	if err != nil {
		return nil, err
	}

	var builder strings.Builder
	builder.WriteString(baseIndent)
	builder.WriteString(parentName)
	builder.WriteString(" {\n")
	for _, lineRange := range lineRanges {
		text, err := sourceLineRangeText(source, lineRange[0], lineRange[1])
		if err != nil {
			return nil, err
		}
		for _, line := range splitLinesKeepEndings(text) {
			if line == "" {
				continue
			}
			builder.WriteString(baseIndent)
			builder.WriteString("  ")
			builder.WriteString(strings.TrimPrefix(line, baseIndent))
		}
	}
	builder.WriteString(baseIndent)
	builder.WriteString("}")
	if sourceLineRangeHasTrailingNewline(source, firstRange[0], firstRange[1]) {
		builder.WriteString("\n")
	}

	edits := []sourceEdit{}
	for i := len(lineRanges) - 1; i >= 0; i-- {
		start, end, err := lineRangeOffsets(source, lineRanges[i][0], lineRanges[i][1])
		if err != nil {
			return nil, err
		}
		replacement := ""
		if i == 0 {
			replacement = builder.String()
		}
		edits = append(edits, sourceEdit{Start: start, End: end, Replacement: replacement})
	}
	return edits, nil
}

func declarationLineRanges(declarations []nodeDeclaration) [][2]int {
	lineRanges := make([][2]int, 0, len(declarations))
	for _, declaration := range declarations {
		lineRanges = append(lineRanges, [2]int{declaration.Range.StartLine, declaration.Range.EndLine})
	}
	sort.SliceStable(lineRanges, func(i, j int) bool {
		return lineRanges[i][0] < lineRanges[j][0]
	})
	return lineRanges
}

func scanNodeDeclarations(source string) []nodeDeclaration {
	out := []nodeDeclaration{}
	context := []string{}
	ignoredMapDepth := 0
	lines := strings.Split(source, "\n")

	for i, line := range lines {
		text := stripD2LineComment(line)
		quote := byte(0)
		statementStart := 0

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

			switch char {
			case '{':
				if ignoredMapDepth > 0 {
					ignoredMapDepth++
					statementStart = index + 1
					continue
				}

				statement := text[statementStart:index]
				if isD2ConnectionStatement(statement) {
					ignoredMapDepth = 1
					statementStart = index + 1
					continue
				}

				pathRange, ok := nodePathRangeFromStatement(statement, i+1, statementStart, false)
				if !ok || isD2ReservedNodePath(pathRange.path) {
					ignoredMapDepth = 1
					statementStart = index + 1
					continue
				}

				fullPath := appendPath(context, pathRange.path)
				endLine, endColumn := blockScopeEnd(lines, i, index)
				out = append(out, nodeDeclaration{
					ID:       strings.Join(fullPath, "."),
					ParentID: strings.Join(context, "."),
					Context:  append([]string{}, context...),
					Path:     append([]string{}, pathRange.path...),
					Range: sourceRange{
						File:        "main.d2",
						StartLine:   i + 1,
						StartColumn: statementStart + firstNonSpaceIndex(statement) + 1,
						EndLine:     endLine,
						EndColumn:   endColumn,
					},
				})
				context = fullPath
				statementStart = index + 1
			case '}':
				if ignoredMapDepth > 0 {
					ignoredMapDepth--
					statementStart = index + 1
					continue
				}

				addNodeDeclarationsFromStatement(&out, context, text[statementStart:index], i+1, statementStart)
				if len(context) > 0 {
					context = context[:len(context)-1]
				}
				statementStart = index + 1
			case ';':
				if ignoredMapDepth == 0 {
					addNodeDeclarationsFromStatement(&out, context, text[statementStart:index], i+1, statementStart)
				}
				statementStart = index + 1
			}
		}

		if ignoredMapDepth == 0 {
			addNodeDeclarationsFromStatement(&out, context, text[statementStart:], i+1, statementStart)
		}
	}
	return out
}

func addNodeDeclarationsFromStatement(out *[]nodeDeclaration, context []string, statement string, lineNumber int, baseColumn int) {
	if strings.TrimSpace(statement) == "" || isD2ConnectionStatement(statement) {
		return
	}
	pathRange, ok := nodePathRangeFromStatement(statement, lineNumber, baseColumn, false)
	if !ok || len(pathRange.path) == 0 || isD2ReservedNodePath(pathRange.path) {
		return
	}
	statementStart := firstNonSpaceIndex(statement)
	statementEnd := len(strings.TrimRight(statement, " \t\r"))
	fullPath := appendPath(context, pathRange.path)
	*out = append(*out, nodeDeclaration{
		ID:       strings.Join(fullPath, "."),
		ParentID: strings.Join(context, "."),
		Context:  append([]string{}, context...),
		Path:     append([]string{}, pathRange.path...),
		Range: sourceRange{
			File:        "main.d2",
			StartLine:   lineNumber,
			StartColumn: baseColumn + statementStart + 1,
			EndLine:     lineNumber,
			EndColumn:   baseColumn + statementEnd + 1,
		},
	})
}

func scanNodeOccurrences(source string, finalSegmentOnly bool) []nodeOccurrence {
	out := []nodeOccurrence{}
	context := []string{}
	ignoredMapDepth := 0

	for i, line := range strings.Split(source, "\n") {
		text := stripD2LineComment(line)
		quote := byte(0)
		statementStart := 0

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

			switch char {
			case '{':
				if ignoredMapDepth > 0 {
					ignoredMapDepth++
					statementStart = index + 1
					continue
				}

				statement := text[statementStart:index]
				if isD2ConnectionStatement(statement) {
					addNodeOccurrencesFromStatement(&out, context, statement, i+1, statementStart, finalSegmentOnly)
					ignoredMapDepth = 1
					statementStart = index + 1
					continue
				}

				pathRange, ok := nodePathRangeFromStatement(statement, i+1, statementStart, finalSegmentOnly)
				if !ok || isD2ReservedNodePath(pathRange.path) {
					ignoredMapDepth = 1
					statementStart = index + 1
					continue
				}

				fullPath := appendPath(context, pathRange.path)
				out = append(out, nodeOccurrence{
					ID:      strings.Join(fullPath, "."),
					Context: append([]string{}, context...),
					Range:   pathRange.rangeValue,
				})
				context = fullPath
				statementStart = index + 1
			case '}':
				if ignoredMapDepth > 0 {
					ignoredMapDepth--
					statementStart = index + 1
					continue
				}

				addNodeOccurrencesFromStatement(&out, context, text[statementStart:index], i+1, statementStart, finalSegmentOnly)
				if len(context) > 0 {
					context = context[:len(context)-1]
				}
				statementStart = index + 1
			case ';':
				if ignoredMapDepth == 0 {
					addNodeOccurrencesFromStatement(&out, context, text[statementStart:index], i+1, statementStart, finalSegmentOnly)
				}
				statementStart = index + 1
			}
		}

		if ignoredMapDepth == 0 {
			addNodeOccurrencesFromStatement(&out, context, text[statementStart:], i+1, statementStart, finalSegmentOnly)
		}
	}
	return out
}

func addNodeOccurrencesFromStatement(out *[]nodeOccurrence, context []string, statement string, lineNumber int, baseColumn int, finalSegmentOnly bool) {
	for _, pathRange := range nodePathRangesFromStatement(statement, lineNumber, baseColumn, finalSegmentOnly) {
		if len(pathRange.path) == 0 || isD2ReservedNodePath(pathRange.path) {
			continue
		}
		*out = append(*out, nodeOccurrence{
			ID:      strings.Join(appendPath(context, pathRange.path), "."),
			Context: append([]string{}, context...),
			Range:   pathRange.rangeValue,
		})
	}
}

func remapMovedNodeID(id string, renamedRoots map[string]string) (string, bool) {
	roots := make([]string, 0, len(renamedRoots))
	for root := range renamedRoots {
		roots = append(roots, root)
	}
	sort.SliceStable(roots, func(i, j int) bool {
		return len(roots[i]) > len(roots[j])
	})
	for _, root := range roots {
		if !idHasPrefix(id, root) {
			continue
		}
		suffix := strings.TrimPrefix(id, root)
		return renamedRoots[root] + suffix, true
	}
	return "", false
}

func idHasPrefix(id, prefix string) bool {
	return id == prefix || strings.HasPrefix(id, prefix+".")
}

func joinD2ID(parentID, child string) string {
	if parentID == "" {
		return child
	}
	return parentID + "." + child
}

func relativeD2ID(id string, context []string) string {
	parts := strings.Split(id, ".")
	if len(context) > 0 && hasPathPrefix(parts, context) {
		return strings.Join(parts[len(context):], ".")
	}
	return id
}

func sourceRangeOverlapsAnyLineRange(r sourceRange, lineRanges [][2]int) bool {
	for _, lineRange := range lineRanges {
		if r.EndLine < lineRange[0] || r.StartLine > lineRange[1] {
			continue
		}
		return true
	}
	return false
}

func applySourceEdits(source string, edits []sourceEdit) (string, error) {
	sortedEdits := append([]sourceEdit{}, edits...)
	sort.SliceStable(sortedEdits, func(i, j int) bool {
		return sortedEdits[i].Start > sortedEdits[j].Start
	})
	for i, edit := range sortedEdits {
		if edit.Start < 0 || edit.End < edit.Start || edit.End > len(source) {
			return "", fmt.Errorf("source edit %d is outside source", i)
		}
		if i > 0 && edit.End > sortedEdits[i-1].Start {
			return "", fmt.Errorf("source edits overlap")
		}
		source = source[:edit.Start] + edit.Replacement + source[edit.End:]
	}
	return source, nil
}

func sourceRangeOffsets(source string, r sourceRange) (int, int, error) {
	starts := lineStartOffsets(source)
	if r.StartLine < 1 || r.StartLine > len(starts) || r.EndLine < 1 || r.EndLine > len(starts) {
		return 0, 0, fmt.Errorf("source range line is outside source")
	}
	lines := splitLinesKeepEndings(source)
	startLineText := strings.TrimSuffix(strings.TrimSuffix(lines[r.StartLine-1], "\n"), "\r")
	endLineText := strings.TrimSuffix(strings.TrimSuffix(lines[r.EndLine-1], "\n"), "\r")
	if r.StartColumn < 1 || r.StartColumn > len(startLineText)+1 || r.EndColumn < 1 || r.EndColumn > len(endLineText)+1 {
		return 0, 0, fmt.Errorf("source range column is outside source")
	}
	return starts[r.StartLine-1] + r.StartColumn - 1, starts[r.EndLine-1] + r.EndColumn - 1, nil
}

func lineRangeOffsets(source string, startLine, endLine int) (int, int, error) {
	starts := lineStartOffsets(source)
	if startLine < 1 || startLine > len(starts) || endLine < startLine || endLine > len(starts) {
		return 0, 0, fmt.Errorf("line range is outside source")
	}
	start := starts[startLine-1]
	if endLine < len(starts) {
		return start, starts[endLine], nil
	}
	return start, len(source), nil
}

func sourceLineRangeText(source string, startLine, endLine int) (string, error) {
	start, end, err := lineRangeOffsets(source, startLine, endLine)
	if err != nil {
		return "", err
	}
	return source[start:end], nil
}

func sourceLineRangeHasTrailingNewline(source string, startLine, endLine int) bool {
	text, err := sourceLineRangeText(source, startLine, endLine)
	if err != nil {
		return false
	}
	return strings.HasSuffix(text, "\n")
}

func lineIndent(source string, lineNumber int) (string, error) {
	lines := splitLinesKeepEndings(source)
	if lineNumber < 1 || lineNumber > len(lines) {
		return "", fmt.Errorf("line %d is outside source", lineNumber)
	}
	line := strings.TrimSuffix(strings.TrimSuffix(lines[lineNumber-1], "\n"), "\r")
	return line[:firstNonSpaceIndex(line)], nil
}

func lineStartOffsets(source string) []int {
	starts := []int{0}
	for i := 0; i < len(source); i++ {
		if source[i] == '\n' && i+1 < len(source) {
			starts = append(starts, i+1)
		}
	}
	return starts
}

func splitLinesKeepEndings(source string) []string {
	if source == "" {
		return []string{""}
	}
	lines := []string{}
	start := 0
	for i := 0; i < len(source); i++ {
		if source[i] == '\n' {
			lines = append(lines, source[start:i+1])
			start = i + 1
		}
	}
	if start < len(source) {
		lines = append(lines, source[start:])
	}
	return lines
}

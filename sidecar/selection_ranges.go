package main

import (
	"sort"
	"strings"
)

func selectionRanges(params selectionRangesParams) []selectionRangeResult {
	results := make([]selectionRangeResult, 0, len(params.Positions))
	for _, position := range params.Positions {
		results = append(results, selectionRangeResult{
			Ranges: selectionRangesAt(params.Source, position.Line, position.Column),
		})
	}
	return results
}

func selectionRangesAt(source string, line, column int) []sourceRange {
	candidates := selectionRangeCandidates(source)
	ranges := make([]sourceRange, 0, len(candidates))
	seen := map[sourceRange]bool{}
	byteColumn := byteColumnForSourcePosition(source, line, column)
	for _, candidate := range candidates {
		if !contains(candidate, line, byteColumn) || seen[candidate] {
			continue
		}
		ranges = append(ranges, candidate)
		seen[candidate] = true
	}
	sort.SliceStable(ranges, func(i, j int) bool {
		leftSize := sourceRangeSize(ranges[i])
		rightSize := sourceRangeSize(ranges[j])
		if leftSize != rightSize {
			return leftSize < rightSize
		}
		return compareSourceRangeStart(ranges[i], ranges[j]) < 0
	})
	return ranges
}

func selectionRangeCandidates(source string) []sourceRange {
	candidates := []sourceRange{}
	candidates = append(candidates, scanD2SourcePathSegmentRanges(source)...)
	for _, sourceRanges := range scanD2SourceTokenRanges(source, true) {
		candidates = append(candidates, sourceRanges...)
	}
	for _, sourceRanges := range scanD2SourceTokenRanges(source, false) {
		candidates = append(candidates, sourceRanges...)
	}
	for _, sourceRanges := range scanNodeScopeRanges(source) {
		candidates = append(candidates, sourceRanges...)
	}
	for _, connectionRange := range scanConnectionSourceRanges(source) {
		candidates = append(candidates, connectionRange.Range, connectionRange.Scope)
	}
	for _, blockRange := range scanBlockSelectionRanges(source) {
		candidates = append(candidates, blockRange.Inner, blockRange.Outer)
	}
	if fullRange, ok := fullSourceRange(source); ok {
		candidates = append(candidates, fullRange)
	}
	return candidates
}

type blockSelectionRange struct {
	Inner sourceRange
	Outer sourceRange
}

type blockSelectionOpen struct {
	Line             int
	Column           int
	OuterStartColumn int
}

func scanD2SourcePathSegmentRanges(source string) []sourceRange {
	out := []sourceRange{}
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
					addD2PathSegmentRangesFromStatement(&out, statement, i+1, statementStart)
					ignoredMapDepth = 1
					statementStart = index + 1
					continue
				}

				pathRange, ok := nodePathRangeFromStatement(statement, i+1, statementStart, false)
				if !ok {
					ignoredMapDepth = 1
					statementStart = index + 1
					continue
				}

				out = append(out, sourcePathSelectionRanges(statement, i+1, statementStart)...)
				if isD2ReservedNodePath(pathRange.path) {
					ignoredMapDepth = 1
					statementStart = index + 1
					continue
				}
				statementStart = index + 1
			case '}':
				if ignoredMapDepth > 0 {
					ignoredMapDepth--
					statementStart = index + 1
					continue
				}

				addD2PathSegmentRangesFromStatement(&out, text[statementStart:index], i+1, statementStart)
				statementStart = index + 1
			case ';':
				if ignoredMapDepth == 0 {
					addD2PathSegmentRangesFromStatement(&out, text[statementStart:index], i+1, statementStart)
				}
				statementStart = index + 1
			}
		}

		if ignoredMapDepth == 0 {
			addD2PathSegmentRangesFromStatement(&out, text[statementStart:], i+1, statementStart)
		}
	}
	return out
}

func addD2PathSegmentRangesFromStatement(out *[]sourceRange, statement string, lineNumber int, baseColumn int) {
	if colonIndex := indexD2StatementColon(statement); colonIndex >= 0 {
		statement = statement[:colonIndex]
	}
	for _, segment := range splitD2ConnectionSegments(statement) {
		pathRange, ok := sourcePathRange(segment.text, lineNumber, baseColumn+segment.start, false)
		if !ok || len(pathRange.path) == 0 {
			continue
		}
		*out = append(*out, pathRange.rangeValue)
		*out = append(*out, sourcePathSegmentSourceRanges(segment.text, lineNumber, baseColumn+segment.start)...)
	}
}

func sourcePathSelectionRanges(text string, line int, baseColumn int) []sourceRange {
	pathRange, ok := sourcePathRange(text, line, baseColumn, false)
	if !ok {
		return nil
	}
	ranges := []sourceRange{pathRange.rangeValue}
	ranges = append(ranges, sourcePathSegmentSourceRanges(text, line, baseColumn)...)
	return ranges
}

func sourcePathSegmentSourceRanges(text string, line int, baseColumn int) []sourceRange {
	segments, ok := sourcePathSegments(text)
	if !ok {
		return nil
	}
	ranges := make([]sourceRange, 0, len(segments))
	for _, segment := range segments {
		ranges = append(ranges, sourceRange{
			File:        "main.d2",
			StartLine:   line,
			StartColumn: baseColumn + segment.startIndex + 1,
			EndLine:     line,
			EndColumn:   baseColumn + segment.endIndex + 1,
		})
	}
	return ranges
}

func scanBlockSelectionRanges(source string) []blockSelectionRange {
	out := []blockSelectionRange{}
	stack := []blockSelectionOpen{}
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
				statement := text[statementStart:index]
				outerStartColumn := statementStart + firstNonSpaceIndex(statement) + 1
				stack = append(stack, blockSelectionOpen{
					Line:             i + 1,
					Column:           index + 1,
					OuterStartColumn: outerStartColumn,
				})
				statementStart = index + 1
			case '}':
				if len(stack) == 0 {
					statementStart = index + 1
					continue
				}
				open := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				out = append(out, blockSelectionRange{
					Inner: blockInnerRange(lines, open, i+1, index+1),
					Outer: sourceRange{
						File:        "main.d2",
						StartLine:   open.Line,
						StartColumn: open.OuterStartColumn,
						EndLine:     i + 1,
						EndColumn:   index + 2,
					},
				})
				statementStart = index + 1
			case ';':
				statementStart = index + 1
			}
		}
	}
	return out
}

func blockInnerRange(lines []string, open blockSelectionOpen, closeLine int, closeColumn int) sourceRange {
	if open.Line == closeLine {
		return sourceRange{
			File:        "main.d2",
			StartLine:   open.Line,
			StartColumn: open.Column + 1,
			EndLine:     closeLine,
			EndColumn:   closeColumn,
		}
	}
	startLine := open.Line + 1
	startColumn := 1
	if startLine > len(lines) {
		startLine = open.Line
		startColumn = open.Column + 1
	}
	return sourceRange{
		File:        "main.d2",
		StartLine:   startLine,
		StartColumn: startColumn,
		EndLine:     closeLine,
		EndColumn:   closeColumn,
	}
}

func fullSourceRange(source string) (sourceRange, bool) {
	if source == "" {
		return sourceRange{}, false
	}
	lines := splitSourceLines(source)
	lastLine := lines[len(lines)-1]
	return sourceRange{
		File:        "main.d2",
		StartLine:   1,
		StartColumn: 1,
		EndLine:     len(lines),
		EndColumn:   len(lastLine) + 1,
	}, true
}

func splitSourceLines(source string) []string {
	return strings.Split(source, "\n")
}

func compareSourceRangeStart(left, right sourceRange) int {
	if left.StartLine != right.StartLine {
		return left.StartLine - right.StartLine
	}
	if left.StartColumn != right.StartColumn {
		return left.StartColumn - right.StartColumn
	}
	if left.EndLine != right.EndLine {
		return left.EndLine - right.EndLine
	}
	return left.EndColumn - right.EndColumn
}

package main

import (
	"regexp"
	"strings"
)

var identifierRE = regexp.MustCompile(`[\p{L}\p{N}\p{M}_.$-]+`)

type connectionSourceRange struct {
	Src   string
	Dst   string
	Range sourceRange
	Scope sourceRange
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

func utf16ColumnToByteColumn(lineText string, column int) int {
	if column <= 1 {
		return 1
	}
	utf16Column := 1
	for byteIndex, runeValue := range lineText {
		if column <= utf16Column {
			return byteIndex + 1
		}
		if runeValue > 0xFFFF {
			utf16Column += 2
		} else {
			utf16Column++
		}
		if column < utf16Column {
			return byteIndex + 1
		}
	}
	return len(lineText) + 1
}

func byteColumnForSourcePosition(source string, line, column int) int {
	lines := strings.Split(source, "\n")
	if line < 1 || line > len(lines) {
		return column
	}
	return utf16ColumnToByteColumn(lines[line-1], column)
}

func scanSourceRanges(source string) map[string][]sourceRange {
	return scanD2SourceTokenRanges(source, false)
}

func scanRenameRanges(source, targetID string) []sourceRange {
	return scanD2SourceTokenRanges(source, true)[targetID]
}

func scanD2SourceTokenRanges(source string, finalSegmentOnly bool) map[string][]sourceRange {
	out := map[string][]sourceRange{}
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
					addD2NodeRangesFromStatement(out, context, statement, i+1, statementStart, finalSegmentOnly)
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
				addScannedRange(out, fullPath, pathRange.rangeValue)
				context = fullPath
				statementStart = index + 1
			case '}':
				if ignoredMapDepth > 0 {
					ignoredMapDepth--
					statementStart = index + 1
					continue
				}

				addD2NodeRangesFromStatement(out, context, text[statementStart:index], i+1, statementStart, finalSegmentOnly)
				if len(context) > 0 {
					context = context[:len(context)-1]
				}
				statementStart = index + 1
			case ';':
				if ignoredMapDepth == 0 {
					addD2NodeRangesFromStatement(out, context, text[statementStart:index], i+1, statementStart, finalSegmentOnly)
				}
				statementStart = index + 1
			}
		}

		if ignoredMapDepth == 0 {
			addD2NodeRangesFromStatement(out, context, text[statementStart:], i+1, statementStart, finalSegmentOnly)
		}
	}
	return out
}

type nodePathRange struct {
	path       []string
	rangeValue sourceRange
}

type statementSegment struct {
	text  string
	start int
}

type pathSegmentRange struct {
	name       string
	startIndex int
	endIndex   int
}

func addD2NodeRangesFromStatement(
	out map[string][]sourceRange,
	context []string,
	statement string,
	lineNumber int,
	baseColumn int,
	finalSegmentOnly bool,
) {
	for _, pathRange := range nodePathRangesFromStatement(statement, lineNumber, baseColumn, finalSegmentOnly) {
		if len(pathRange.path) == 0 || isD2ReservedNodePath(pathRange.path) {
			continue
		}
		addScannedRange(out, appendPath(context, pathRange.path), pathRange.rangeValue)
	}
}

func scanNodeScopeRanges(source string) map[string][]sourceRange {
	out := map[string][]sourceRange{}
	lines := strings.Split(source, "\n")
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "//") {
			continue
		}
		if strings.Contains(line, "->") {
			continue
		}
		terminator := strings.IndexAny(line, ":{")
		if terminator < 0 {
			continue
		}
		pathRange, ok := sourcePathRange(line[:terminator], i+1, 0, false)
		if !ok {
			continue
		}
		endLine, endColumn := nodeScopeEnd(lines, i)
		out[strings.Join(pathRange.path, ".")] = append(out[strings.Join(pathRange.path, ".")], sourceRange{
			File:        "main.d2",
			StartLine:   i + 1,
			StartColumn: pathRange.rangeValue.StartColumn,
			EndLine:     endLine,
			EndColumn:   endColumn,
		})
	}
	return out
}

func nodeScopeEnd(lines []string, startLine int) (int, int) {
	depth := 0
	seenBlock := false
	for i := startLine; i < len(lines); i++ {
		line := stripD2LineComment(lines[i])
		quote := byte(0)
		for j := 0; j < len(line); j++ {
			char := line[j]
			if quote != 0 {
				if char == '\\' {
					j++
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
				depth++
				seenBlock = true
			case '}':
				if depth > 0 {
					depth--
				}
				if seenBlock && depth == 0 {
					return i + 1, j + 2
				}
			}
		}
		if !seenBlock {
			return i + 1, len(lines[i]) + 1
		}
	}
	return len(lines), len(lines[len(lines)-1]) + 1
}

func addScannedRange(out map[string][]sourceRange, path []string, rangeValue sourceRange) {
	if len(path) == 0 {
		return
	}
	out[strings.Join(path, ".")] = append(out[strings.Join(path, ".")], rangeValue)
}

func scanConnectionSourceRanges(source string) []connectionSourceRange {
	var out []connectionSourceRange
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

				statement := text[statementStart : index+1]
				if isD2ConnectionStatement(statement) {
					endLine, endColumn := blockScopeEnd(lines, i, index)
					scopeRange := sourceRange{
						File:        "main.d2",
						StartLine:   i + 1,
						StartColumn: statementStart + firstNonSpaceIndex(statement) + 1,
						EndLine:     endLine,
						EndColumn:   endColumn,
					}
					addConnectionRangesFromStatementWithScope(&out, context, statement, i+1, statementStart, &scopeRange)
					ignoredMapDepth = 1
					statementStart = index + 1
					continue
				}

				pathRange, ok := nodePathRangeFromStatement(text[statementStart:index], i+1, statementStart, false)
				if !ok || isD2ReservedNodePath(pathRange.path) {
					ignoredMapDepth = 1
					statementStart = index + 1
					continue
				}

				context = appendPath(context, pathRange.path)
				statementStart = index + 1
			case '}':
				if ignoredMapDepth > 0 {
					ignoredMapDepth--
					statementStart = index + 1
					continue
				}

				addConnectionRangesFromStatement(&out, context, text[statementStart:index], i+1, statementStart)
				if len(context) > 0 {
					context = context[:len(context)-1]
				}
				statementStart = index + 1
			case ';':
				if ignoredMapDepth == 0 {
					addConnectionRangesFromStatement(&out, context, text[statementStart:index], i+1, statementStart)
				}
				statementStart = index + 1
			}
		}

		if ignoredMapDepth == 0 {
			addConnectionRangesFromStatement(&out, context, text[statementStart:], i+1, statementStart)
		}
	}
	return out
}

func addConnectionRangesFromStatement(out *[]connectionSourceRange, context []string, statement string, lineNumber int, baseColumn int) {
	addConnectionRangesFromStatementWithScope(out, context, statement, lineNumber, baseColumn, nil)
}

func addConnectionRangesFromStatementWithScope(out *[]connectionSourceRange, context []string, statement string, lineNumber int, baseColumn int, scopeOverride *sourceRange) {
	fullStatement := statement
	if colonIndex := indexD2StatementColon(statement); colonIndex >= 0 {
		statement = statement[:colonIndex]
	}
	scopeRange := sourceRange{
		File:        "main.d2",
		StartLine:   lineNumber,
		StartColumn: baseColumn + firstNonSpaceIndex(fullStatement) + 1,
		EndLine:     lineNumber,
		EndColumn:   baseColumn + len(fullStatement) + 1,
	}
	if scopeOverride != nil {
		scopeRange = *scopeOverride
	}

	cursor := 0
	var previousPath []string
	for {
		operatorIndex, operator, ok := nextConnectionOperator(statement[cursor:])
		if !ok {
			return
		}

		operatorStart := cursor + operatorIndex
		operatorEnd := operatorStart + len(operator)
		leftPath := previousPath
		if len(leftPath) == 0 {
			pathRange, ok := sourcePathRange(statement[cursor:operatorStart], lineNumber, baseColumn+cursor, false)
			if !ok {
				cursor = operatorEnd
				continue
			}
			leftPath = pathRange.path
		}

		rightEnd := connectionEndpointSegmentEnd(statement[operatorEnd:])
		rightRange, ok := sourcePathRange(statement[operatorEnd:operatorEnd+rightEnd], lineNumber, baseColumn+operatorEnd, false)
		if !ok {
			return
		}

		src, dst := directedConnectionEndpoints(
			qualifiedConnectionPath(context, leftPath),
			qualifiedConnectionPath(context, rightRange.path),
			operator,
		)
		*out = append(*out, connectionSourceRange{
			Src: src,
			Dst: dst,
			Range: sourceRange{
				File:        "main.d2",
				StartLine:   lineNumber,
				StartColumn: baseColumn + operatorStart + 1,
				EndLine:     lineNumber,
				EndColumn:   baseColumn + operatorEnd + 1,
			},
			Scope: scopeRange,
		})

		previousPath = rightRange.path
		cursor = operatorEnd
	}
}

func hasConnectionOperator(statement string) bool {
	_, _, ok := nextConnectionOperator(statement)
	return ok
}

func isD2ConnectionStatement(statement string) bool {
	if colonIndex := indexD2StatementColon(statement); colonIndex >= 0 {
		statement = statement[:colonIndex]
	}
	return hasConnectionOperator(statement)
}

func blockScopeEnd(lines []string, startLine int, openBraceColumn int) (int, int) {
	depth := 0
	for i := startLine; i < len(lines); i++ {
		line := stripD2LineComment(lines[i])
		startColumn := 0
		if i == startLine {
			startColumn = openBraceColumn
		}
		quote := byte(0)
		for j := startColumn; j < len(line); j++ {
			char := line[j]
			if quote != 0 {
				if char == '\\' {
					j++
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
				depth++
			case '}':
				if depth > 0 {
					depth--
				}
				if depth == 0 {
					return i + 1, j + 2
				}
			}
		}
	}
	if len(lines) == 0 {
		return 1, 1
	}
	return len(lines), len(lines[len(lines)-1]) + 1
}

func qualifiedConnectionPath(context []string, path []string) string {
	if len(path) == 0 {
		return ""
	}
	if len(context) == 0 || hasPathPrefix(path, context) {
		return strings.Join(path, ".")
	}
	return strings.Join(appendPath(context, path), ".")
}

func nextConnectionOperator(text string) (int, string, bool) {
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

		switch {
		case strings.HasPrefix(text[index:], "<->"):
			return index, "<->", true
		case strings.HasPrefix(text[index:], "->"):
			return index, "->", true
		case strings.HasPrefix(text[index:], "<-"):
			return index, "<-", true
		case strings.HasPrefix(text[index:], "--"):
			return index, "--", true
		}
	}
	return -1, "", false
}

func connectionEndpointSegmentEnd(text string) int {
	if idx, _, ok := nextConnectionOperator(text); ok {
		return idx
	}
	return len(text)
}

func directedConnectionEndpoints(leftPath, rightPath, _ string) (string, string) {
	return leftPath, rightPath
}

func nodePathRangeFromStatement(statement string, lineNumber int, baseColumn int, finalSegmentOnly bool) (nodePathRange, bool) {
	ranges := nodePathRangesFromStatement(statement, lineNumber, baseColumn, finalSegmentOnly)
	if len(ranges) == 0 {
		return nodePathRange{}, false
	}
	return ranges[0], true
}

func nodePathRangesFromStatement(statement string, lineNumber int, baseColumn int, finalSegmentOnly bool) []nodePathRange {
	if colonIndex := indexD2StatementColon(statement); colonIndex >= 0 {
		statement = statement[:colonIndex]
	}

	segments := splitD2ConnectionSegments(statement)
	ranges := make([]nodePathRange, 0, len(segments))
	for _, segment := range segments {
		pathRange, ok := sourcePathRange(segment.text, lineNumber, baseColumn+segment.start, finalSegmentOnly)
		if ok {
			ranges = append(ranges, pathRange)
		}
	}
	return ranges
}

func splitD2ConnectionSegments(statement string) []statementSegment {
	segments := []statementSegment{}
	quote := byte(0)
	start := 0
	for index := 0; index < len(statement); index++ {
		char := statement[index]
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

		operatorLength := 0
		switch {
		case strings.HasPrefix(statement[index:], "<->"):
			operatorLength = 3
		case strings.HasPrefix(statement[index:], "->"),
			strings.HasPrefix(statement[index:], "<-"),
			strings.HasPrefix(statement[index:], "--"):
			operatorLength = 2
		}
		if operatorLength == 0 {
			continue
		}

		segments = append(segments, statementSegment{text: statement[start:index], start: start})
		start = index + operatorLength
		index += operatorLength - 1
	}
	segments = append(segments, statementSegment{text: statement[start:], start: start})
	return segments
}

func indexD2StatementColon(statement string) int {
	quote := byte(0)
	for index := 0; index < len(statement); index++ {
		char := statement[index]
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
		if char == ':' {
			return index
		}
	}
	return -1
}

func sourcePathRange(text string, line int, baseColumn int, finalSegmentOnly bool) (nodePathRange, bool) {
	segments, ok := sourcePathSegments(text)
	if !ok || len(segments) == 0 {
		return nodePathRange{}, false
	}

	rangeSegment := pathSegmentRange{
		startIndex: segments[0].startIndex,
		endIndex:   segments[len(segments)-1].endIndex,
	}
	if finalSegmentOnly {
		rangeSegment = segments[len(segments)-1]
	}

	path := make([]string, 0, len(segments))
	for _, segment := range segments {
		path = append(path, segment.name)
	}
	return nodePathRange{
		path: path,
		rangeValue: sourceRange{
			File:        "main.d2",
			StartLine:   line,
			StartColumn: baseColumn + rangeSegment.startIndex + 1,
			EndLine:     line,
			EndColumn:   baseColumn + rangeSegment.endIndex + 1,
		},
	}, true
}

func sourcePathSegments(text string) ([]pathSegmentRange, bool) {
	start := firstNonSpaceIndex(text)
	if start >= len(text) {
		return nil, false
	}
	if text[start] == '"' || text[start] == '\'' {
		end := quotedTokenEnd(text, start)
		if end <= start+1 {
			return nil, false
		}
		return []pathSegmentRange{{
			name:       text[start+1 : end],
			startIndex: start,
			endIndex:   end + 1,
		}}, true
	}

	if segments, ok := simpleUnquotedPathSegments(text, start); ok {
		return segments, true
	}

	loc := identifierRE.FindStringIndex(text)
	if loc == nil {
		return nil, false
	}
	token := strings.TrimSuffix(text[loc[0]:loc[1]], ".")
	if token == "" {
		return nil, false
	}

	segments := []pathSegmentRange{}
	segmentStart := loc[0]
	for index := 0; index <= len(token); index++ {
		if index < len(token) && token[index] != '.' {
			continue
		}
		if loc[0]+index > segmentStart {
			segments = append(segments, pathSegmentRange{
				name:       text[segmentStart : loc[0]+index],
				startIndex: segmentStart,
				endIndex:   loc[0] + index,
			})
		}
		segmentStart = loc[0] + index + 1
	}
	if len(segments) == 0 {
		return nil, false
	}
	return segments, true
}

func simpleUnquotedPathSegments(text string, start int) ([]pathSegmentRange, bool) {
	end := len(text)
	for end > start && isD2PathWhitespace(text[end-1]) {
		end--
	}
	if end <= start {
		return nil, false
	}

	for index := start; index < end; index++ {
		if !isSimpleUnquotedPathChar(text[index]) {
			return nil, false
		}
	}

	segments := []pathSegmentRange{}
	segmentStart := start
	for index := start; index <= end; index++ {
		if index < end && text[index] != '.' {
			continue
		}
		nameStart := segmentStart
		for nameStart < index && isD2PathWhitespace(text[nameStart]) {
			nameStart++
		}
		nameEnd := index
		for nameEnd > nameStart && isD2PathWhitespace(text[nameEnd-1]) {
			nameEnd--
		}
		if nameEnd <= nameStart {
			return nil, false
		}
		segments = append(segments, pathSegmentRange{
			name:       text[nameStart:nameEnd],
			startIndex: nameStart,
			endIndex:   nameEnd,
		})
		segmentStart = index + 1
	}
	if len(segments) == 0 {
		return nil, false
	}
	return segments, true
}

func isSimpleUnquotedPathChar(char byte) bool {
	switch {
	case char >= 'A' && char <= 'Z':
		return true
	case char >= 'a' && char <= 'z':
		return true
	case char >= '0' && char <= '9':
		return true
	case char == '_' || char == '$' || char == '-' || char == '.' || isD2PathWhitespace(char):
		return true
	default:
		return false
	}
}

func isD2PathWhitespace(char byte) bool {
	switch char {
	case ' ', '\t', '\r', '\n':
		return true
	default:
		return false
	}
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

func rangesForShape(id string, tokenRanges, scopeRanges map[string][]sourceRange) []sourceRange {
	combined := append([]sourceRange{}, rangesFor(id, tokenRanges)...)
	combined = append(combined, rangesFor(id, scopeRanges)...)
	return combined
}

func nonNilRanges(ranges []sourceRange) []sourceRange {
	if ranges == nil {
		return []sourceRange{}
	}
	return ranges
}

func rangesForConnection(src, dst string, index int, connectionRanges []connectionSourceRange, tokenRanges map[string][]sourceRange) []sourceRange {
	matched := 0
	for _, candidate := range connectionRanges {
		if !endpointMatches(candidate.Src, src) || !endpointMatches(candidate.Dst, dst) {
			continue
		}
		if matched == index {
			return []sourceRange{candidate.Range, candidate.Scope}
		}
		matched++
	}

	combined := append([]sourceRange{}, rangesFor(src, tokenRanges)...)
	combined = append(combined, rangesFor(dst, tokenRanges)...)
	return combined
}

func endpointMatches(sourceToken, objectID string) bool {
	if sourceToken == objectID {
		return true
	}
	parts := strings.Split(objectID, ".")
	return len(parts) > 0 && sourceToken == parts[len(parts)-1]
}

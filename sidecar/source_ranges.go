package main

import (
	"regexp"
	"strings"
)

var identifierRE = regexp.MustCompile(`[A-Za-z0-9_.$-]+`)

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

				pathRange, ok := nodePathRangeFromStatement(text[statementStart:index], i+1, statementStart, finalSegmentOnly)
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

func addScannedRange(out map[string][]sourceRange, path []string, rangeValue sourceRange) {
	if len(path) == 0 {
		return
	}
	out[strings.Join(path, ".")] = append(out[strings.Join(path, ".")], rangeValue)
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

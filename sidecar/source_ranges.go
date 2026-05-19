package main

import (
	"regexp"
	"strconv"
	"strings"
)

var identifierRE = regexp.MustCompile(`[A-Za-z0-9_.$-]+`)
var connectionIndexRE = regexp.MustCompile(`\[(\d+)\]$`)

type connectionSourceRange struct {
	Src   string
	Dst   string
	Range sourceRange
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

func scanConnectionSourceRanges(source string) []connectionSourceRange {
	var out []connectionSourceRange
	var context []string
	lines := strings.Split(source, "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "//") {
			continue
		}
		context = popClosedContexts(context, trimmed)
		out = append(out, scanConnectionLineSourceRanges(line, i+1, context)...)
		context = pushOpenedContext(context, line)
	}
	return out
}

func scanConnectionTokenRanges(out map[string][]sourceRange, line string, lineNumber int) {
	start := 0
	for {
		segment := line[start:]
		idx, operator, ok := nextConnectionOperator(segment)
		if terminator := strings.IndexAny(segment, ":{"); terminator >= 0 && (idx < 0 || terminator < idx) {
			addTokenRange(out, segment[:terminator], lineNumber, start)
			return
		}
		if !ok {
			addTokenRange(out, segment, lineNumber, start)
			return
		}
		arrow := start + idx
		addTokenRange(out, line[start:arrow], lineNumber, start)
		start = arrow + len(operator)
	}
}

func scanConnectionLineSourceRanges(line string, lineNumber int, context []string) []connectionSourceRange {
	var out []connectionSourceRange
	cursor := 0
	var previousToken string

	for {
		segment := line[cursor:]
		idx, operator, ok := nextConnectionOperator(segment)
		if !ok {
			return out
		}

		operatorStart := cursor + idx
		operatorEnd := operatorStart + len(operator)
		leftToken := previousToken
		if leftToken == "" {
			token, _, _, ok := sourceTokenRange(line[cursor:operatorStart])
			if !ok {
				cursor = operatorEnd
				continue
			}
			leftToken = token
		}

		rightSegment := line[operatorEnd:]
		rightEnd := connectionEndpointSegmentEnd(rightSegment)
		rightToken, _, _, ok := sourceTokenRange(rightSegment[:rightEnd])
		if !ok {
			return out
		}

		src, dst := directedConnectionEndpoints(
			qualifyConnectionEndpoint(leftToken, context),
			qualifyConnectionEndpoint(rightToken, context),
			operator,
		)
		out = append(out, connectionSourceRange{
			Src: src,
			Dst: dst,
			Range: sourceRange{
				File:        "main.d2",
				StartLine:   lineNumber,
				StartColumn: operatorStart + 1,
				EndLine:     lineNumber,
				EndColumn:   operatorEnd + 1,
			},
		})

		previousToken = rightToken
		cursor = operatorEnd
	}
}

func popClosedContexts(context []string, trimmedLine string) []string {
	for strings.HasPrefix(trimmedLine, "}") && len(context) > 0 {
		context = context[:len(context)-1]
		trimmedLine = strings.TrimSpace(strings.TrimPrefix(trimmedLine, "}"))
	}
	return context
}

func pushOpenedContext(context []string, line string) []string {
	if _, _, ok := nextConnectionOperator(line); ok {
		return context
	}
	openBrace := strings.Index(line, "{")
	if openBrace < 0 {
		return context
	}
	token, _, _, ok := sourceTokenRange(line[:openBrace])
	if !ok {
		return context
	}
	return append(context, token)
}

func qualifyConnectionEndpoint(token string, context []string) string {
	if token == "" || strings.Contains(token, ".") || len(context) == 0 {
		return token
	}
	return strings.Join(append(append([]string{}, context...), token), ".")
}

func nextConnectionOperator(text string) (int, string, bool) {
	for i := 0; i < len(text); i++ {
		switch text[i] {
		case ':', '{':
			return -1, "", false
		case '<':
			if strings.HasPrefix(text[i:], "<->") {
				return i, "<->", true
			}
			if strings.HasPrefix(text[i:], "<-") {
				return i, "<-", true
			}
		case '-':
			if strings.HasPrefix(text[i:], "->") {
				return i, "->", true
			}
			if strings.HasPrefix(text[i:], "--") {
				return i, "--", true
			}
		}
	}
	return -1, "", false
}

func connectionEndpointSegmentEnd(text string) int {
	if idx, _, ok := nextConnectionOperator(text); ok {
		return idx
	}
	if idx := strings.IndexAny(text, ":{"); idx >= 0 {
		return idx
	}
	return len(text)
}

func directedConnectionEndpoints(leftToken, rightToken, operator string) (string, string) {
	if operator == "<-" {
		return rightToken, leftToken
	}
	return leftToken, rightToken
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

func rangesForConnection(id, src, dst string, connectionRanges []connectionSourceRange, tokenRanges map[string][]sourceRange) []sourceRange {
	index := connectionIndex(id)
	matched := 0
	for _, candidate := range connectionRanges {
		if !endpointMatches(candidate.Src, src) || !endpointMatches(candidate.Dst, dst) {
			continue
		}
		if matched == index {
			return []sourceRange{candidate.Range}
		}
		matched++
	}

	combined := append([]sourceRange{}, rangesFor(src, tokenRanges)...)
	combined = append(combined, rangesFor(dst, tokenRanges)...)
	return combined
}

func connectionIndex(id string) int {
	match := connectionIndexRE.FindStringSubmatch(id)
	if len(match) != 2 {
		return 0
	}
	index, err := strconv.Atoi(match[1])
	if err != nil {
		return 0
	}
	return index
}

func endpointMatches(sourceToken, objectID string) bool {
	if sourceToken == objectID {
		return true
	}
	parts := strings.Split(objectID, ".")
	return len(parts) > 0 && sourceToken == parts[len(parts)-1]
}

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
		token, start, _, ok := sourceTokenRange(line[:terminator])
		if !ok {
			continue
		}
		endLine, endColumn := nodeScopeEnd(lines, i)
		out[token] = append(out[token], sourceRange{
			File:        "main.d2",
			StartLine:   i + 1,
			StartColumn: start + 1,
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
		line := lines[i]
		for j := 0; j < len(line); j++ {
			switch line[j] {
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
			return i + 1, len(line) + 1
		}
	}
	return len(lines), len(lines[len(lines)-1]) + 1
}

func scanConnectionScopeRanges(source string) map[string][]sourceRange {
	out := map[string][]sourceRange{}
	lines := strings.Split(source, "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "//") {
			continue
		}
		if !strings.Contains(line, "->") {
			continue
		}
		tokens := connectionTokens(line)
		for j := 0; j+1 < len(tokens); j++ {
			out[connectionKey(tokens[j], tokens[j+1])] = append(out[connectionKey(tokens[j], tokens[j+1])], sourceRange{
				File:        "main.d2",
				StartLine:   i + 1,
				StartColumn: 1,
				EndLine:     i + 1,
				EndColumn:   len(line) + 1,
			})
		}
	}
	return out
}

func connectionTokens(line string) []string {
	if terminator := strings.IndexAny(line, ":{"); terminator >= 0 {
		line = line[:terminator]
	}
	parts := strings.Split(line, "->")
	tokens := make([]string, 0, len(parts))
	for _, part := range parts {
		token, _, _, ok := sourceTokenRange(part)
		if ok {
			tokens = append(tokens, token)
		}
	}
	return tokens
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

func rangesForConnection(src, dst string, tokenRanges, scopeRanges map[string][]sourceRange) []sourceRange {
	combined := append([]sourceRange{}, rangesFor(src, tokenRanges)...)
	combined = append(combined, rangesFor(dst, tokenRanges)...)
	combined = append(combined, scopeRanges[connectionKey(src, dst)]...)
	return combined
}

func connectionKey(src, dst string) string {
	return src + "\x00" + dst
}

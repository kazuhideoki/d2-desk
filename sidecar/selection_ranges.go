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
	for _, candidate := range candidates {
		if !contains(candidate, line, column) || seen[candidate] {
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
	if fullRange, ok := fullSourceRange(source); ok {
		candidates = append(candidates, fullRange)
	}
	return candidates
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

package main

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

var renameIdentifierRE = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func renameNode(params renameNodeParams) (renameNodeResult, error) {
	targetID := strings.TrimSpace(params.ID)
	newName := strings.TrimSpace(params.NewName)
	if targetID == "" {
		return renameNodeResult{}, fmt.Errorf("missing node id")
	}
	if newName == "" {
		return renameNodeResult{}, fmt.Errorf("node name cannot be empty")
	}
	if !renameIdentifierRE.MatchString(newName) {
		return renameNodeResult{}, fmt.Errorf("node name must contain only letters, numbers, underscores, or hyphens")
	}
	if isD2ReservedNodeKey(newName) {
		return renameNodeResult{}, fmt.Errorf("%q is reserved", newName)
	}

	ranges := scanRenameRanges(params.Source, targetID)
	if len(ranges) == 0 {
		return renameNodeResult{}, fmt.Errorf("node %q was not found in source", targetID)
	}

	renamedSource, err := replaceSourceRanges(params.Source, ranges, newName)
	if err != nil {
		return renameNodeResult{}, err
	}
	return renameNodeResult{
		Source: renamedSource,
		ID:     renamedNodeID(targetID, newName),
	}, nil
}

func replaceSourceRanges(source string, ranges []sourceRange, replacement string) (string, error) {
	lines := strings.Split(source, "\n")
	sortedRanges := append([]sourceRange{}, ranges...)
	sort.SliceStable(sortedRanges, func(i, j int) bool {
		if sortedRanges[i].StartLine == sortedRanges[j].StartLine {
			return sortedRanges[i].StartColumn > sortedRanges[j].StartColumn
		}
		return sortedRanges[i].StartLine > sortedRanges[j].StartLine
	})

	for _, rangeValue := range sortedRanges {
		lineIndex := rangeValue.StartLine - 1
		if lineIndex < 0 || lineIndex >= len(lines) {
			return "", fmt.Errorf("rename range line %d is outside source", rangeValue.StartLine)
		}
		line := lines[lineIndex]
		start := rangeValue.StartColumn - 1
		end := rangeValue.EndColumn - 1
		if start < 0 || end < start || end > len(line) {
			return "", fmt.Errorf("rename range %d:%d-%d is outside source", rangeValue.StartLine, rangeValue.StartColumn, rangeValue.EndColumn)
		}
		lines[lineIndex] = line[:start] + replacement + line[end:]
	}
	return strings.Join(lines, "\n"), nil
}

func renamedNodeID(id, newName string) string {
	parts := strings.Split(id, ".")
	parts[len(parts)-1] = newName
	return strings.Join(parts, ".")
}

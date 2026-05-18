package main

import (
	"sort"
	"strings"

	"oss.terrastruct.com/d2/d2ast"
	"oss.terrastruct.com/d2/d2lsp"
	"oss.terrastruct.com/d2/d2target"
)

type completionItem struct {
	Label      string `json:"label"`
	Kind       string `json:"kind"`
	Detail     string `json:"detail"`
	InsertText string `json:"insertText"`
}

var d2KeyCompletionItems = buildD2KeyCompletionItems()

var d2StyleKeyCompletionItems = buildD2StyleKeyCompletionItems()

var d2ArrowheadKeyCompletionItems = completionItemsForLabels([]string{
	"shape",
	"label",
	"style.filled",
}, "arrowhead property", "keyword")

var d2LabelKeyCompletionItems = completionItemsForLabels([]string{
	"near",
}, "label property", "keyword")

var d2ConfigKeyCompletionItems = completionItemsForLabels([]string{
	"sketch",
	"theme-id",
	"dark-theme-id",
	"pad",
	"layout-engine",
	"center",
	"theme-overrides",
	"dark-theme-overrides",
	"data",
}, "config property", "keyword")

var d2ThemeOverrideKeyCompletionItems = completionItemsForLabels([]string{
	"N1", "N2", "N3", "N4", "N5", "N6", "N7",
	"B1", "B2", "B3", "B4", "B5", "B6",
	"AA2", "AA4", "AA5", "AB4", "AB5",
}, "theme override", "keyword")

func complete(params completeParams) ([]completionItem, error) {
	items, err := d2lsp.GetCompletionItems(params.Source, params.Line, params.Column)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		probeSource, probeColumn := completionProbeWithoutCurrentValue(params.Source, params.Line, params.Column)
		if probeSource != params.Source || probeColumn != params.Column {
			items, err = d2lsp.GetCompletionItems(probeSource, params.Line, probeColumn)
			if err != nil {
				return nil, err
			}
		}
	}
	if completions := d2ContextValueCompletions(params); completions != nil {
		return completions, nil
	}
	if len(items) == 0 {
		completions := d2KeyCompletions(params)
		if len(completions) > 0 {
			return completions, nil
		}
	}
	completions := make([]completionItem, 0, len(items))
	for _, item := range items {
		completions = append(completions, completionItem{
			Label:      item.Label,
			Kind:       completionKind(item.Kind),
			Detail:     item.Detail,
			InsertText: item.InsertText,
		})
	}
	return completions, nil
}

func mergeCompletionItems(primary, supplemental []completionItem) []completionItem {
	if len(supplemental) == 0 {
		return primary
	}
	seen := make(map[string]struct{}, len(primary)+len(supplemental))
	for _, item := range primary {
		seen[item.Label] = struct{}{}
	}
	for _, item := range supplemental {
		if _, ok := seen[item.Label]; ok {
			continue
		}
		seen[item.Label] = struct{}{}
		primary = append(primary, item)
	}
	return primary
}

func buildD2KeyCompletionItems() []completionItem {
	seen := map[string]struct{}{}
	labels := make([]string, 0, len(d2ast.SimpleReservedKeywords)+len(d2ast.CompositeReservedKeywords)+len(d2ast.BoardKeywords))
	appendMapKeys(&labels, seen, d2ast.SimpleReservedKeywords)
	appendMapKeys(&labels, seen, d2ast.CompositeReservedKeywords)
	appendMapKeys(&labels, seen, d2ast.BoardKeywords)
	sort.Strings(labels)
	return completionItemsForLabels(labels, "property", "keyword")
}

func buildD2StyleKeyCompletionItems() []completionItem {
	seen := map[string]struct{}{}
	labels := make([]string, 0, len(d2ast.StyleKeywords))
	appendMapKeys(&labels, seen, d2ast.StyleKeywords)
	sort.Strings(labels)
	return completionItemsForLabels(labels, "style property", "style")
}

func appendMapKeys(labels *[]string, seen map[string]struct{}, values map[string]struct{}) {
	for value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		*labels = append(*labels, value)
	}
}

func completionItemsForLabels(labels []string, detail, kind string) []completionItem {
	items := make([]completionItem, 0, len(labels))
	for _, label := range labels {
		items = append(items, completionItem{
			Label:      label,
			Kind:       kind,
			Detail:     detail,
			InsertText: label + ": ",
		})
	}
	return items
}

func d2KeyCompletions(params completeParams) []completionItem {
	lines := strings.Split(params.Source, "\n")
	if params.Line < 0 || params.Line >= len(lines) {
		return nil
	}

	lineText := lines[params.Line]
	column := clamp(params.Column, 0, len(lineText))
	start := column
	for start > 0 && isCompletionValueChar(lineText[start-1]) {
		start--
	}
	if start == column && !isD2KeyCompletionBoundary(lineText[:start]) {
		return nil
	}
	if !isD2KeyCompletionBoundary(lineText[:start]) {
		return nil
	}

	typedKey := lineText[start:column]
	items := d2KeyItemsForContext(completionKeyContext(params.Source, params.Line, start))
	completions := make([]completionItem, 0, len(items))
	for _, item := range items {
		if strings.HasPrefix(item.Label, typedKey) {
			completions = append(completions, item)
		}
	}
	return completions
}

func d2KeyItemsForContext(context []string) []completionItem {
	if hasTrailingContext(context, "vars", "d2-config") {
		return d2ConfigKeyCompletionItems
	}
	if hasTrailingContext(context, "theme-overrides") || hasTrailingContext(context, "dark-theme-overrides") {
		return d2ThemeOverrideKeyCompletionItems
	}
	if hasTrailingContext(context, "source-arrowhead") || hasTrailingContext(context, "target-arrowhead") {
		return d2ArrowheadKeyCompletionItems
	}
	if hasTrailingContext(context, "label") || hasTrailingContext(context, "icon") || hasTrailingContext(context, "tooltip") {
		return d2LabelKeyCompletionItems
	}
	if hasTrailingContext(context, "style") {
		return d2StyleKeyCompletionItems
	}
	return d2KeyCompletionItems
}

func d2ContextValueCompletions(params completeParams) []completionItem {
	context := completionKeyContext(params.Source, params.Line, params.Column)
	if len(context) == 0 {
		return nil
	}

	last := context[len(context)-1]
	switch {
	case hasTrailingContext(context, "vars", "d2-config", "sketch"),
		hasTrailingContext(context, "vars", "d2-config", "center"):
		return booleanCompletions()
	case hasTrailingContext(context, "vars", "d2-config", "layout-engine"):
		return []completionItem{{
			Label:      "(layout engine)",
			Kind:       "keyword",
			Detail:     "e.g. dagre, elk",
			InsertText: "",
		}}
	case hasTrailingContext(context, "vars", "d2-config", "theme-id"),
		hasTrailingContext(context, "vars", "d2-config", "dark-theme-id"),
		hasTrailingContext(context, "vars", "d2-config", "pad"):
		return []completionItem{{
			Label:      "(integer)",
			Kind:       "keyword",
			Detail:     "number",
			InsertText: "",
		}}
	case hasTrailingContext(context, "theme-overrides", last),
		hasTrailingContext(context, "dark-theme-overrides", last):
		return colorCompletions()
	case last == "font":
		return completionItemsWithInsertText([]string{"default", "mono"}, "font", "keyword")
	case hasTrailingContext(context, "source-arrowhead", "shape"),
		hasTrailingContext(context, "target-arrowhead", "shape"):
		return arrowheadShapeCompletions()
	case hasTrailingContext(context, "label", "near"),
		hasTrailingContext(context, "icon", "near"):
		return labelPositionCompletions()
	case hasTrailingContext(context, "tooltip", "near"):
		return tooltipPositionCompletions()
	case last == "link":
		return []completionItem{{
			Label:      "(URL or board path)",
			Kind:       "keyword",
			Detail:     "link",
			InsertText: "",
		}}
	case last == "grid-rows" || last == "grid-columns":
		return []completionItem{{
			Label:      "(positive integer)",
			Kind:       "keyword",
			Detail:     "grid",
			InsertText: "",
		}}
	case last == "grid-gap" || last == "vertical-gap" || last == "horizontal-gap":
		return []completionItem{{
			Label:      "(non-negative integer)",
			Kind:       "keyword",
			Detail:     "grid",
			InsertText: "",
		}}
	case last == "near":
		return nearConstantCompletions()
	}
	return nil
}

func arrowheadShapeCompletions() []completionItem {
	labels := make([]string, 0, len(d2target.Arrowheads))
	for arrowhead := range d2target.Arrowheads {
		labels = append(labels, arrowhead)
	}
	sort.Strings(labels)
	return completionItemsWithInsertText(labels, "arrowhead shape", "shape")
}

func booleanCompletions() []completionItem {
	return completionItemsWithInsertText([]string{"true", "false"}, "boolean", "keyword")
}

func colorCompletions() []completionItem {
	return []completionItem{{
		Label:      "(color name or hex code)",
		Kind:       "keyword",
		Detail:     "e.g. blue, #ff0000",
		InsertText: "",
	}}
}

func nearConstantCompletions() []completionItem {
	return completionItemsWithInsertText(d2ast.NearConstantsArray, "near position", "keyword")
}

func labelPositionCompletions() []completionItem {
	return completionItemsWithInsertText(d2ast.LabelPositionsArray, "label position", "keyword")
}

func tooltipPositionCompletions() []completionItem {
	return completionItemsWithInsertText(d2ast.TooltipPositionsArray, "tooltip position", "keyword")
}

func completionItemsWithInsertText(labels []string, detail, kind string) []completionItem {
	items := make([]completionItem, 0, len(labels))
	for _, label := range labels {
		items = append(items, completionItem{
			Label:      label,
			Kind:       kind,
			Detail:     detail,
			InsertText: label,
		})
	}
	return items
}

func isD2KeyCompletionBoundary(prefix string) bool {
	trimmedPrefix := strings.TrimRight(prefix, " \t")
	if trimmedPrefix == "" {
		return true
	}
	if strings.HasSuffix(trimmedPrefix, ":") || strings.HasSuffix(trimmedPrefix, "->") {
		return false
	}
	switch trimmedPrefix[len(trimmedPrefix)-1] {
	case '{', ';', '.':
		return true
	default:
		return false
	}
}

type completionContextFrame struct {
	parts []string
}

func completionKeyContext(source string, line, column int) []string {
	lines := strings.Split(source, "\n")
	if line < 0 || line >= len(lines) {
		return nil
	}

	frames := make([]completionContextFrame, 0, 4)
	for index := 0; index <= line; index++ {
		limit := len(lines[index])
		if index == line {
			limit = clamp(column, 0, limit)
		}
		frames = scanCompletionContextLine(frames, lines[index], limit)
	}

	context := flattenCompletionContext(frames)
	currentPrefix := stripD2LineComment(lines[line][:clamp(column, 0, len(lines[line]))])
	trimmedPrefix := strings.TrimRight(currentPrefix, " \t")
	if strings.HasSuffix(trimmedPrefix, ".") {
		if key := extractD2KeyPath(strings.TrimSuffix(trimmedPrefix, ".")); len(key) > 0 {
			return append(context, key...)
		}
		return context
	}

	colonIndex := strings.LastIndex(currentPrefix, ":")
	if colonIndex < 0 {
		return context
	}
	suffix := currentPrefix[colonIndex+1:]
	if strings.ContainsAny(suffix, ";{}") {
		return context
	}
	if key := extractD2KeyPath(currentPrefix[:colonIndex]); len(key) > 0 {
		context = append(context, key...)
	}
	return context
}

func scanCompletionContextLine(frames []completionContextFrame, text string, limit int) []completionContextFrame {
	quote := byte(0)
	for index := 0; index < limit; index++ {
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
		if char == '#' || (char == '/' && index+1 < limit && text[index+1] == '/') {
			return frames
		}
		switch char {
		case '{':
			prefix := text[:index]
			colonIndex := strings.LastIndex(prefix, ":")
			if colonIndex < 0 {
				continue
			}
			if key := extractD2KeyPath(prefix[:colonIndex]); len(key) > 0 {
				frames = append(frames, completionContextFrame{parts: key})
			}
		case '}':
			if len(frames) > 0 {
				frames = frames[:len(frames)-1]
			}
		}
	}
	return frames
}

func flattenCompletionContext(frames []completionContextFrame) []string {
	context := make([]string, 0, len(frames))
	for _, frame := range frames {
		context = append(context, frame.parts...)
	}
	return context
}

func stripD2LineComment(text string) string {
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
		if char == '#' || (char == '/' && index+1 < len(text) && text[index+1] == '/') {
			return text[:index]
		}
	}
	return text
}

func extractD2KeyPath(prefix string) []string {
	end := len(prefix)
	for end > 0 && (prefix[end-1] == ' ' || prefix[end-1] == '\t') {
		end--
	}
	start := end
	for start > 0 {
		char := prefix[start-1]
		if isCompletionValueChar(char) || char == '.' {
			start--
			continue
		}
		break
	}
	if start == end {
		return nil
	}

	parts := strings.Split(prefix[start:end], ".")
	context := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == "" {
			continue
		}
		context = append(context, part)
	}
	return context
}

func hasTrailingContext(context []string, suffix ...string) bool {
	if len(context) < len(suffix) {
		return false
	}
	offset := len(context) - len(suffix)
	for index, part := range suffix {
		if context[offset+index] != part {
			return false
		}
	}
	return true
}

func completionProbeWithoutCurrentValue(source string, line, column int) (string, int) {
	lines := strings.Split(source, "\n")
	if line < 0 || line >= len(lines) {
		return source, column
	}

	lineText := lines[line]
	column = clamp(column, 0, len(lineText))
	start := column
	for start > 0 && isCompletionValueChar(lineText[start-1]) {
		start--
	}
	end := column
	for end < len(lineText) && isCompletionValueChar(lineText[end]) {
		end++
	}
	if start == end {
		return source, column
	}

	prefix := lineText[:start]
	colonIndex := strings.LastIndex(prefix, ":")
	if colonIndex < 0 || strings.TrimSpace(prefix[colonIndex+1:]) != "" {
		return source, column
	}

	lines[line] = lineText[:start] + lineText[end:]
	return strings.Join(lines, "\n"), start
}

func isCompletionValueChar(char byte) bool {
	return char == '-' || char == '_' || (char >= '0' && char <= '9') || (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z')
}

func completionKind(kind d2lsp.CompletionKind) string {
	switch kind {
	case d2lsp.StyleCompletion:
		return "style"
	case d2lsp.ShapeCompletion:
		return "shape"
	default:
		return "keyword"
	}
}

func clamp(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

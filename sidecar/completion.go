package main

import (
	"sort"
	"strconv"
	"strings"

	"oss.terrastruct.com/d2/d2ast"
	"oss.terrastruct.com/d2/d2lsp"
	"oss.terrastruct.com/d2/d2target"
	"oss.terrastruct.com/d2/d2themes"
	"oss.terrastruct.com/d2/d2themes/d2themescatalog"
)

type completionItem struct {
	Label          string   `json:"label"`
	Kind           string   `json:"kind"`
	Detail         string   `json:"detail"`
	Description    string   `json:"description"`
	Documentation  string   `json:"documentation"`
	InsertText     string   `json:"insertText"`
	FilterText     string   `json:"filterText"`
	ColorSwatches  []string `json:"colorSwatches,omitempty"`
	PreviewThemeID *int64   `json:"previewThemeId,omitempty"`
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
	context := completionKeyContext(params.Source, params.Line, params.Column)
	if completions := d2ContextValueCompletions(params); completions != nil {
		return enrichCompletionItems(completions, context), nil
	}
	if completions := d2ChildNodeCompletions(params); len(completions) > 0 {
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
	if nodeCompletions := d2TopLevelNodeCompletions(params); len(nodeCompletions) > 0 {
		completions = mergeCompletionItems(completions, nodeCompletions)
	}
	return enrichCompletionItems(completions, context), nil
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
	context := completionKeyContext(params.Source, params.Line, start)
	nodeCompletions := d2TopLevelNodeCompletions(params)
	if isD2ConnectionEndpointCompletionBoundary(lineText[:start]) {
		return nodeCompletions
	}

	items := d2KeyItemsForContext(context)
	completions := make([]completionItem, 0, len(items))
	for _, item := range items {
		if strings.HasPrefix(item.Label, typedKey) {
			completions = append(completions, enrichCompletionItem(item, context))
		}
	}
	return mergeCompletionItems(completions, nodeCompletions)
}

func d2ChildNodeCompletions(params completeParams) []completionItem {
	parentPath, typedChild, ok := completionDotParentPath(params.Source, params.Line, params.Column)
	if !ok {
		return nil
	}

	children := collectD2ChildNodes(sourceWithoutCurrentDotCompletion(params.Source, params.Line, params.Column))
	labels := completionChildNodeLabels(params, children, parentPath)
	if len(labels) == 0 {
		return nil
	}

	completions := make([]completionItem, 0, len(labels))
	for _, label := range labels {
		if !strings.HasPrefix(label, typedChild) {
			continue
		}
		completions = append(completions, completionItem{
			Label:         label,
			Kind:          "shape",
			Detail:        "child node",
			Description:   "子ノードを参照",
			Documentation: "子ノードをドット記法で参照",
			InsertText:    label,
		})
	}
	return completions
}

func completionChildNodeLabels(params completeParams, children map[string][]string, parentPath []string) []string {
	context := completionKeyContext(params.Source, params.Line, params.Column)
	context = trimPathSuffix(context, parentPath)

	if len(context) > 0 && !hasPathPrefix(parentPath, context) {
		relativePath := appendPath(context, parentPath)
		if labels := children[completionPathKey(relativePath)]; len(labels) > 0 {
			return labels
		}
	}

	if labels := children[completionPathKey(parentPath)]; len(labels) > 0 {
		return labels
	}

	if len(context) == 0 || len(parentPath) != 1 {
		return nil
	}
	contextLabels := children[completionPathKey(context)]
	if !containsCompletionLabel(contextLabels, parentPath[0]) {
		return nil
	}
	return siblingCompletionLabels(contextLabels, parentPath[0])
}

func siblingCompletionLabels(labels []string, current string) []string {
	siblings := make([]string, 0, len(labels))
	for _, label := range labels {
		if label != current {
			siblings = append(siblings, label)
		}
	}
	return siblings
}

func containsCompletionLabel(labels []string, target string) bool {
	for _, label := range labels {
		if label == target {
			return true
		}
	}
	return false
}

func trimPathSuffix(path, suffix []string) []string {
	if len(suffix) == 0 || len(suffix) > len(path) {
		return path
	}
	offset := len(path) - len(suffix)
	for index := range suffix {
		if path[offset+index] != suffix[index] {
			return path
		}
	}
	return path[:offset]
}

func hasPathPrefix(path, prefix []string) bool {
	if len(prefix) > len(path) {
		return false
	}
	for index := range prefix {
		if path[index] != prefix[index] {
			return false
		}
	}
	return true
}

func d2TopLevelNodeCompletions(params completeParams) []completionItem {
	typedKey, ok := d2NodeReferenceCompletionPrefix(params)
	if !ok {
		return nil
	}

	children := collectD2ChildNodes(sourceWithoutCurrentCompletionToken(params.Source, params.Line, params.Column))
	labels := children[completionPathKey(nil)]
	if len(labels) == 0 {
		return nil
	}

	completions := make([]completionItem, 0, len(labels))
	for _, label := range labels {
		if !strings.HasPrefix(label, typedKey) {
			continue
		}
		completions = append(completions, completionItem{
			Label:         label,
			Kind:          "shape",
			Detail:        "node",
			Description:   "既存ノードを参照",
			Documentation: "既存ノードを参照",
			InsertText:    label,
		})
	}
	return completions
}

func d2NodeReferenceCompletionPrefix(params completeParams) (string, bool) {
	lines := strings.Split(params.Source, "\n")
	if params.Line < 0 || params.Line >= len(lines) {
		return "", false
	}

	lineText := lines[params.Line]
	column := clamp(params.Column, 0, len(lineText))
	start := column
	for start > 0 && isCompletionValueChar(lineText[start-1]) {
		start--
	}

	prefix := lineText[:start]
	context := completionKeyContext(params.Source, params.Line, start)
	if isD2ConnectionEndpointCompletionBoundary(prefix) {
		return lineText[start:column], true
	}
	if len(context) == 0 && isD2KeyCompletionBoundary(prefix) {
		return lineText[start:column], true
	}
	return "", false
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
		hasTrailingContext(context, "vars", "d2-config", "pad"):
		if hasTrailingContext(context, "vars", "d2-config", "theme-id") {
			return themeCompletions(d2themescatalog.LightCatalog, "light theme", true)
		}
		return []completionItem{{
			Label:      "(integer)",
			Kind:       "keyword",
			Detail:     "number",
			InsertText: "",
		}}
	case hasTrailingContext(context, "vars", "d2-config", "dark-theme-id"):
		return themeCompletions(d2themescatalog.DarkCatalog, "dark theme", false)
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

func themeCompletions(themes []d2themes.Theme, detail string, previewTheme bool) []completionItem {
	items := make([]completionItem, 0, len(themes))
	for _, theme := range themes {
		label := strconv.FormatInt(theme.ID, 10)
		colors := themeColorSwatches(theme)
		item := completionItem{
			Label:         label,
			Kind:          "keyword",
			Detail:        detail,
			Description:   theme.Name,
			Documentation: themeCompletionDocumentation(theme, detail, colors),
			InsertText:    label,
			FilterText:    label + " " + theme.Name,
			ColorSwatches: colors,
		}
		if previewTheme {
			themeID := theme.ID
			item.PreviewThemeID = &themeID
		}
		items = append(items, item)
	}
	return items
}

func themeColorSwatches(theme d2themes.Theme) []string {
	return []string{
		theme.Colors.B1,
		theme.Colors.B2,
		theme.Colors.B3,
		theme.Colors.B4,
		theme.Colors.B5,
		theme.Colors.B6,
	}
}

func themeCompletionDocumentation(theme d2themes.Theme, detail string, colors []string) string {
	var b strings.Builder
	b.WriteString(theme.Name)
	b.WriteString("\n\n種類: D2 ")
	b.WriteString(detail)
	b.WriteString("\n\nID: ")
	b.WriteString(strconv.FormatInt(theme.ID, 10))
	b.WriteString("\n\nPalette: ")
	for i, color := range colors {
		if i > 0 {
			b.WriteString(" ")
		}
		b.WriteString("`")
		b.WriteString(color)
		b.WriteString("`")
	}
	return b.String()
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

func enrichCompletionItems(items []completionItem, context []string) []completionItem {
	enriched := make([]completionItem, 0, len(items))
	for _, item := range items {
		enriched = append(enriched, enrichCompletionItem(item, context))
	}
	return enriched
}

func enrichCompletionItem(item completionItem, context []string) completionItem {
	if item.Description == "" {
		item.Description = completionDescription(item, context)
	}
	if item.Documentation == "" {
		item.Documentation = completionDocumentation(item)
	}
	return item
}

func completionDescription(item completionItem, context []string) string {
	if hasTrailingContext(context, "source-arrowhead") || hasTrailingContext(context, "target-arrowhead") {
		if description, ok := arrowheadKeyDescriptions[item.Label]; ok {
			return description
		}
	}
	if hasTrailingContext(context, "label") || hasTrailingContext(context, "icon") || hasTrailingContext(context, "tooltip") {
		if description, ok := labelIconTooltipKeyDescriptions[item.Label]; ok {
			return description
		}
	}
	if hasTrailingContext(context, "vars", "d2-config") {
		if description, ok := configKeyDescriptions[item.Label]; ok {
			return description
		}
	}
	if hasTrailingContext(context, "theme-overrides") || hasTrailingContext(context, "dark-theme-overrides") {
		return "テーマ色スロットを指定"
	}
	if hasTrailingContext(context, "style") {
		if description, ok := styleKeyDescriptions[item.Label]; ok {
			return description
		}
	}

	if len(context) > 0 {
		last := context[len(context)-1]
		switch {
		case last == "direction":
			if description, ok := directionValueDescriptions[item.Label]; ok {
				return description
			}
		case last == "shape":
			if description, ok := shapeValueDescriptions[item.Label]; ok {
				return description
			}
		case last == "fill-pattern":
			if description, ok := fillPatternValueDescriptions[item.Label]; ok {
				return description
			}
		case last == "text-transform":
			if description, ok := textTransformValueDescriptions[item.Label]; ok {
				return description
			}
		case last == "font":
			if description, ok := fontValueDescriptions[item.Label]; ok {
				return description
			}
		case hasTrailingContext(context, "source-arrowhead", "shape"),
			hasTrailingContext(context, "target-arrowhead", "shape"):
			if description, ok := arrowheadShapeValueDescriptions[item.Label]; ok {
				return description
			}
		case hasTrailingContext(context, "label", "near"),
			hasTrailingContext(context, "icon", "near"),
			hasTrailingContext(context, "tooltip", "near"),
			last == "near":
			if description := nearPositionDescription(item.Label); description != "" {
				return description
			}
		}
	}

	if item.Detail == "boolean" {
		if item.Label == "true" {
			return "有効にする"
		}
		if item.Label == "false" {
			return "無効にする"
		}
	}
	if description, ok := keyDescriptions[item.Label]; ok {
		return description
	}
	return ""
}

func completionDocumentation(item completionItem) string {
	if item.Description == "" && item.Detail == "" {
		return ""
	}
	if item.Description == "" {
		return "D2 " + item.Detail
	}
	if item.Detail == "" {
		return item.Description
	}
	return item.Description + "\n\n種類: D2 " + item.Detail
}

func nearPositionDescription(label string) string {
	switch label {
	case "top-left":
		return "左上に配置"
	case "top-center":
		return "上中央に配置"
	case "top-right":
		return "右上に配置"
	case "center-left":
		return "中央左に配置"
	case "center-center":
		return "中央に配置"
	case "center-right":
		return "中央右に配置"
	case "bottom-left":
		return "左下に配置"
	case "bottom-center":
		return "下中央に配置"
	case "bottom-right":
		return "右下に配置"
	case "outside-top-left":
		return "外側の左上に配置"
	case "outside-top-center":
		return "外側の上中央に配置"
	case "outside-top-right":
		return "外側の右上に配置"
	case "outside-left-top":
		return "外側の左上寄りに配置"
	case "outside-left-center":
		return "外側の左中央に配置"
	case "outside-left-bottom":
		return "外側の左下寄りに配置"
	case "outside-right-top":
		return "外側の右上寄りに配置"
	case "outside-right-center":
		return "外側の右中央に配置"
	case "outside-right-bottom":
		return "外側の右下寄りに配置"
	case "outside-bottom-left":
		return "外側の左下に配置"
	case "outside-bottom-center":
		return "外側の下中央に配置"
	case "outside-bottom-right":
		return "外側の右下に配置"
	case "border-top-left":
		return "境界線の左上に配置"
	case "border-top-center":
		return "境界線の上中央に配置"
	case "border-top-right":
		return "境界線の右上に配置"
	case "border-left-top":
		return "境界線の左上寄りに配置"
	case "border-left-center":
		return "境界線の左中央に配置"
	case "border-left-bottom":
		return "境界線の左下寄りに配置"
	case "border-right-top":
		return "境界線の右上寄りに配置"
	case "border-right-center":
		return "境界線の右中央に配置"
	case "border-right-bottom":
		return "境界線の右下寄りに配置"
	case "border-bottom-left":
		return "境界線の左下に配置"
	case "border-bottom-center":
		return "境界線の下中央に配置"
	case "border-bottom-right":
		return "境界線の右下に配置"
	default:
		return ""
	}
}

var keyDescriptions = map[string]string{
	"label":            "表示する文字を指定",
	"shape":            "図形の形を指定",
	"icon":             "アイコン画像を表示",
	"constraint":       "配置時の制約を指定",
	"tooltip":          "ホバー時の説明を設定",
	"link":             "クリック時のリンク先を指定",
	"near":             "別要素の近くに配置",
	"width":            "幅をピクセルで指定",
	"height":           "高さをピクセルで指定",
	"direction":        "全体のレイアウト方向を指定",
	"top":              "上からの位置を指定",
	"left":             "左からの位置を指定",
	"grid-rows":        "グリッドの行数を指定",
	"grid-columns":     "グリッドの列数を指定",
	"grid-gap":         "グリッドの間隔を指定",
	"vertical-gap":     "縦方向の間隔を指定",
	"horizontal-gap":   "横方向の間隔を指定",
	"class":            "適用するクラスを指定",
	"vars":             "変数やD2設定を定義",
	"style":            "見た目の設定をまとめる",
	"source-arrowhead": "接続元の矢印端を設定",
	"target-arrowhead": "接続先の矢印端を設定",
	"classes":          "再利用するスタイルを定義",
	"layers":           "レイヤーを定義",
	"scenarios":        "シナリオを定義",
	"steps":            "ステップを定義",
}

var styleKeyDescriptions = map[string]string{
	"opacity":        "透明度を指定",
	"stroke":         "枠線の色を指定",
	"fill":           "塗り色を指定",
	"fill-pattern":   "塗りパターンを指定",
	"stroke-width":   "枠線の太さを指定",
	"stroke-dash":    "破線の間隔を指定",
	"border-radius":  "角丸の大きさを指定",
	"font":           "文字フォントを指定",
	"font-size":      "文字サイズを指定",
	"font-color":     "文字色を指定",
	"bold":           "文字を太字にする",
	"italic":         "文字を斜体にする",
	"underline":      "文字に下線を付ける",
	"text-transform": "英字の大文字小文字を変換",
	"shadow":         "影を表示",
	"multiple":       "複数要素風に表示",
	"double-border":  "二重線の枠を表示",
	"3d":             "立体風に表示",
	"animated":       "接続線をアニメーション表示",
	"filled":         "矢印端を塗りつぶす",
}

var arrowheadKeyDescriptions = map[string]string{
	"shape":        "矢印端の形を指定",
	"label":        "矢印端のラベルを指定",
	"style.filled": "矢印端を塗りつぶす",
}

var labelIconTooltipKeyDescriptions = map[string]string{
	"near": "表示位置を指定",
}

var configKeyDescriptions = map[string]string{
	"sketch":               "手描き風表示を切り替え",
	"theme-id":             "ライトテーマを指定",
	"dark-theme-id":        "ダークテーマを指定",
	"pad":                  "図全体の余白を指定",
	"layout-engine":        "レイアウトエンジンを指定",
	"center":               "図を中央寄せにする",
	"theme-overrides":      "ライトテーマ色を上書き",
	"dark-theme-overrides": "ダークテーマ色を上書き",
	"data":                 "設定用データを渡す",
}

var directionValueDescriptions = map[string]string{
	"up":    "上方向に並べる",
	"down":  "下方向に並べる",
	"right": "右方向に並べる",
	"left":  "左方向に並べる",
}

var shapeValueDescriptions = map[string]string{
	"rectangle":        "長方形の図形",
	"square":           "正方形の図形",
	"page":             "ページ形の図形",
	"parallelogram":    "平行四辺形の図形",
	"document":         "書類形の図形",
	"cylinder":         "データベース風の図形",
	"queue":            "キュー風の図形",
	"package":          "パッケージ風の図形",
	"step":             "ステップ形の図形",
	"callout":          "吹き出し形の図形",
	"stored_data":      "保存データ風の図形",
	"person":           "人物を表す図形",
	"c4-person":        "C4モデルの人物図形",
	"diamond":          "ひし形の図形",
	"oval":             "楕円の図形",
	"circle":           "円形の図形",
	"hexagon":          "六角形の図形",
	"cloud":            "クラウド形の図形",
	"text":             "テキストだけを表示",
	"code":             "コードブロック風に表示",
	"class":            "クラス図風に表示",
	"sql_table":        "SQLテーブル風に表示",
	"image":            "画像を表示する図形",
	"sequence_diagram": "シーケンス図として表示",
	"hierarchy":        "階層図として表示",
}

var fillPatternValueDescriptions = map[string]string{
	"none":  "塗りパターンなし",
	"dots":  "ドット柄で塗る",
	"lines": "線柄で塗る",
	"grain": "粒状の質感で塗る",
	"paper": "紙の質感で塗る",
}

var textTransformValueDescriptions = map[string]string{
	"none":       "文字変換なし",
	"uppercase":  "英字を大文字に変換",
	"lowercase":  "英字を小文字に変換",
	"capitalize": "単語の先頭を大文字に変換",
}

var fontValueDescriptions = map[string]string{
	"default": "標準フォントを使う",
	"mono":    "等幅フォントを使う",
}

var arrowheadShapeValueDescriptions = map[string]string{
	"none":             "矢印端を表示しない",
	"arrow":            "通常の矢印端",
	"triangle":         "三角形の矢印端",
	"diamond":          "ひし形の矢印端",
	"circle":           "円形の矢印端",
	"box":              "四角形の矢印端",
	"cf-one":           "Crow's Footの1を表す",
	"cf-many":          "Crow's Footの多を表す",
	"cf-one-required":  "必須の1を表す",
	"cf-many-required": "必須の多を表す",
	"cross":            "交差印の矢印端",
}

func isD2KeyCompletionBoundary(prefix string) bool {
	trimmedPrefix := strings.TrimRight(prefix, " \t")
	if trimmedPrefix == "" {
		return true
	}
	if strings.HasSuffix(trimmedPrefix, ":") {
		return false
	}
	if isD2ConnectionEndpointCompletionBoundary(prefix) {
		return true
	}
	switch trimmedPrefix[len(trimmedPrefix)-1] {
	case '{', ';', '.':
		return true
	default:
		return false
	}
}

func isD2ConnectionEndpointCompletionBoundary(prefix string) bool {
	trimmedPrefix := strings.TrimRight(prefix, " \t")
	return strings.HasSuffix(trimmedPrefix, "->") ||
		strings.HasSuffix(trimmedPrefix, "<-") ||
		strings.HasSuffix(trimmedPrefix, "--") ||
		strings.HasSuffix(trimmedPrefix, "<->")
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

func completionDotParentPath(source string, line, column int) ([]string, string, bool) {
	lines := strings.Split(source, "\n")
	if line < 0 || line >= len(lines) {
		return nil, "", false
	}

	lineText := lines[line]
	column = clamp(column, 0, len(lineText))
	start := column
	for start > 0 && isCompletionValueChar(lineText[start-1]) {
		start--
	}
	typedChild := lineText[start:column]
	prefix := strings.TrimRight(lineText[:start], " \t")
	if !strings.HasSuffix(prefix, ".") {
		return nil, "", false
	}

	parentPath := extractD2KeyPath(strings.TrimSuffix(prefix, "."))
	if len(parentPath) == 0 {
		return nil, "", false
	}
	return parentPath, typedChild, true
}

func sourceWithoutCurrentCompletionToken(source string, line, column int) string {
	lines := strings.Split(source, "\n")
	if line < 0 || line >= len(lines) {
		return source
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
		return source
	}

	lines[line] = lineText[:start] + lineText[end:]
	return strings.Join(lines, "\n")
}

func sourceWithoutCurrentDotCompletion(source string, line, column int) string {
	lines := strings.Split(source, "\n")
	if line < 0 || line >= len(lines) {
		return source
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

	prefix := strings.TrimRight(lineText[:start], " \t")
	if !strings.HasSuffix(prefix, ".") {
		return sourceWithoutCurrentCompletionToken(source, line, column)
	}
	parentEnd := len(prefix) - 1
	parentStart := parentEnd
	for parentStart > 0 {
		char := lineText[parentStart-1]
		if isCompletionValueChar(char) || char == '.' {
			parentStart--
			continue
		}
		break
	}
	lines[line] = lineText[:parentStart] + lineText[end:]
	return strings.Join(lines, "\n")
}

func collectD2ChildNodes(source string) map[string][]string {
	children := map[string][]string{}
	seen := map[string]map[string]struct{}{}
	context := []string{}
	ignoredMapDepth := 0

	for _, line := range strings.Split(source, "\n") {
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

				path := nodePathFromStatement(text[statementStart:index])
				if len(path) == 0 || isD2ReservedNodePath(path) {
					ignoredMapDepth = 1
					statementStart = index + 1
					continue
				}
				fullPath := appendPath(context, path)
				addD2NodePath(children, seen, fullPath)
				context = fullPath
				statementStart = index + 1
			case '}':
				if ignoredMapDepth > 0 {
					ignoredMapDepth--
					statementStart = index + 1
					continue
				}

				addD2NodePathsFromStatement(children, seen, context, text[statementStart:index])
				if len(context) > 0 {
					context = context[:len(context)-1]
				}
				statementStart = index + 1
			case ';':
				if ignoredMapDepth == 0 {
					addD2NodePathsFromStatement(children, seen, context, text[statementStart:index])
				}
				statementStart = index + 1
			}
		}

		if ignoredMapDepth == 0 {
			addD2NodePathsFromStatement(children, seen, context, text[statementStart:])
		}
	}

	for _, labels := range children {
		sort.Strings(labels)
	}
	return children
}

func addD2NodePathsFromStatement(children map[string][]string, seen map[string]map[string]struct{}, context []string, statement string) {
	statement = strings.TrimSpace(statement)
	if statement == "" {
		return
	}

	for _, path := range nodePathsFromStatement(statement) {
		if len(path) == 0 || isD2ReservedNodePath(path) {
			continue
		}
		addD2NodePath(children, seen, appendPath(context, path))
	}
}

func nodePathFromStatement(statement string) []string {
	paths := nodePathsFromStatement(statement)
	if len(paths) == 0 {
		return nil
	}
	return paths[0]
}

func nodePathsFromStatement(statement string) [][]string {
	statement = strings.TrimSpace(statement)
	if statement == "" {
		return nil
	}

	if colonIndex := strings.Index(statement, ":"); colonIndex >= 0 {
		statement = statement[:colonIndex]
	}
	normalized := strings.ReplaceAll(statement, "<->", "->")
	normalized = strings.ReplaceAll(normalized, "<-", "->")
	normalized = strings.ReplaceAll(normalized, "--", "->")
	parts := strings.Split(normalized, "->")
	paths := make([][]string, 0, len(parts))
	for _, part := range parts {
		if path := extractD2KeyPath(part); len(path) > 0 {
			paths = append(paths, path)
		}
	}
	return paths
}

func addD2NodePath(children map[string][]string, seen map[string]map[string]struct{}, path []string) {
	for index := 0; index < len(path); index++ {
		parentKey := completionPathKey(path[:index])
		child := path[index]
		if seen[parentKey] == nil {
			seen[parentKey] = map[string]struct{}{}
		}
		if _, ok := seen[parentKey][child]; ok {
			continue
		}
		seen[parentKey][child] = struct{}{}
		children[parentKey] = append(children[parentKey], child)
	}
}

func appendPath(prefix, suffix []string) []string {
	out := make([]string, 0, len(prefix)+len(suffix))
	out = append(out, prefix...)
	out = append(out, suffix...)
	return out
}

func completionPathKey(path []string) string {
	return strings.Join(path, "\x00")
}

func isD2ReservedNodePath(path []string) bool {
	if len(path) == 0 {
		return true
	}
	return isD2ReservedNodeKey(path[0])
}

func isD2ReservedNodeKey(key string) bool {
	if _, ok := d2ast.SimpleReservedKeywords[key]; ok {
		return true
	}
	if _, ok := d2ast.CompositeReservedKeywords[key]; ok {
		return true
	}
	if _, ok := d2ast.BoardKeywords[key]; ok {
		return true
	}
	if _, ok := d2ast.StyleKeywords[key]; ok {
		return true
	}
	switch key {
	case "source-arrowhead", "target-arrowhead", "theme-overrides", "dark-theme-overrides", "d2-config":
		return true
	default:
		return false
	}
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

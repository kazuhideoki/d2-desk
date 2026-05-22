package main

import (
	"strings"

	"oss.terrastruct.com/d2/d2ast"
	"oss.terrastruct.com/d2/d2parser"
)

func semanticTokens(params semanticTokenParams) ([]semanticToken, error) {
	ast, err := d2parser.Parse("main.d2", strings.NewReader(params.Source), &d2parser.ParseOptions{
		UTF16Pos: true,
	})
	if ast == nil {
		return []semanticToken{}, nil
	}

	tokens := collectSemanticTokens(ast, params.Source)
	if err != nil {
		return tokens, nil
	}
	return tokens, nil
}

func collectSemanticTokens(root d2ast.Node, source string) []semanticToken {
	tokens := []semanticToken{}
	if rootMap, ok := root.(*d2ast.Map); ok {
		collectSemanticTokensFromMap(&tokens, rootMap, nil, source)
	}
	return tokens
}

func collectSemanticTokensFromMap(tokens *[]semanticToken, m *d2ast.Map, context []string, source string) {
	for _, box := range m.Nodes {
		key, ok := box.Unbox().(*d2ast.Key)
		if !ok {
			continue
		}

		keyContext := appendPath(context, semanticTokenKeyPath(key))
		if boolean, ok := key.Value.Unbox().(*d2ast.Boolean); ok && isBooleanSemanticTokenContext(keyContext) {
			*tokens = append(*tokens, semanticToken{
				TokenType:   "boolean",
				SourceRange: sourceRangeFromD2Range(boolean.Range, source),
			})
		}

		if childMap, ok := key.Value.Unbox().(*d2ast.Map); ok {
			collectSemanticTokensFromMap(tokens, childMap, keyContext, source)
		}
	}
}

func semanticTokenKeyPath(key *d2ast.Key) []string {
	var path []string
	if key.Key != nil {
		path = append(path, key.Key.StringIDA()...)
	}
	if key.EdgeKey != nil {
		path = append(path, key.EdgeKey.StringIDA()...)
	}
	return path
}

func isBooleanSemanticTokenContext(context []string) bool {
	if isRootD2ConfigContext(context, "sketch") || isRootD2ConfigContext(context, "center") {
		return true
	}
	if len(context) == 0 {
		return false
	}
	last := context[len(context)-1]
	return hasTrailingContext(context, "style", last) && isD2StyleBooleanKey(last)
}

func isD2StyleBooleanKey(key string) bool {
	switch key {
	case "shadow",
		"3d",
		"multiple",
		"animated",
		"bold",
		"italic",
		"underline",
		"filled",
		"double-border":
		return true
	default:
		return false
	}
}

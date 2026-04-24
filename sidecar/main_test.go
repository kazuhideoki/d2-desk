package main

import "testing"

func TestCompileProducesSVGAndObjects(t *testing.T) {
	result, err := compile(compileParams{Source: "api -> db\napi: API\ndb: Database"})
	if err != nil {
		t.Fatal(err)
	}
	if result.SVG == "" {
		t.Fatal("expected SVG")
	}
	if len(result.Objects) == 0 {
		t.Fatal("expected object map entries")
	}
}

func TestNodeAtFindsSourceObject(t *testing.T) {
	result := nodeAt(nodeAtParams{Source: "api -> db", Line: 1, Column: 2})
	if result["id"] == "" {
		t.Fatal("expected object id")
	}
}

package main

import (
	"sort"

	"oss.terrastruct.com/d2/d2target"
)

func buildObjectMap(source string, diagram *d2target.Diagram) []objectMap {
	sourceRanges := scanSourceRanges(source)
	connectionRanges := scanConnectionSourceRanges(source)
	if diagram == nil {
		return nil
	}
	objects := make([]objectMap, 0, len(diagram.Shapes)+len(diagram.Connections))
	for _, shape := range diagram.Shapes {
		x, y := float64(shape.Pos.X), float64(shape.Pos.Y)
		w, h := float64(shape.Width), float64(shape.Height)
		objects = append(objects, objectMap{
			ID:           shape.ID,
			Kind:         "shape",
			BoardPath:    []string{},
			Label:        shape.Label,
			SourceRanges: nonNilRanges(rangesFor(shape.ID, sourceRanges)),
			Preview:      previewBox{X: &x, Y: &y, Width: &w, Height: &h},
		})
	}
	for _, conn := range diagram.Connections {
		route := make([]point, 0, len(conn.Route))
		for _, p := range conn.Route {
			if p != nil {
				route = append(route, point{X: p.X, Y: p.Y})
			}
		}
		objects = append(objects, objectMap{
			ID:           conn.ID,
			Kind:         "connection",
			BoardPath:    []string{},
			Label:        conn.Label,
			SourceRanges: nonNilRanges(rangesForConnection(conn.ID, conn.Src, conn.Dst, connectionRanges, sourceRanges)),
			Preview:      previewBox{Route: route},
		})
	}
	sort.SliceStable(objects, func(i, j int) bool {
		if objects[i].Kind == objects[j].Kind {
			return objects[i].ID < objects[j].ID
		}
		return objects[i].Kind == "shape"
	})
	return objects
}

func nodeAt(params nodeAtParams) map[string]string {
	for _, obj := range buildObjectMap(params.Source, nilFallbackDiagram(params.Source)) {
		for _, r := range obj.SourceRanges {
			if contains(r, params.Line, params.Column) {
				return map[string]string{"id": obj.ID}
			}
		}
	}
	for id, ranges := range scanSourceRanges(params.Source) {
		for _, r := range ranges {
			if contains(r, params.Line, params.Column) {
				return map[string]string{"id": id}
			}
		}
	}
	return map[string]string{}
}

func nilFallbackDiagram(source string) *d2target.Diagram {
	diagram, _, _ := render(source, "dagre", 0)
	return diagram
}

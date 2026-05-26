package main

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"oss.terrastruct.com/d2/d2target"
	"oss.terrastruct.com/d2/lib/geo"
)

type blockScope struct {
	id    string
	depth int
}

func buildObjectMap(source string, diagram *d2target.Diagram, boardPath []string) []objectMap {
	sourceRanges := scanSourceRanges(source)
	nodeScopeRanges := scanNodeScopeRanges(source)
	connectionRanges := scanConnectionSourceRanges(source)
	objectLinks := scanObjectLinks(source)
	if diagram == nil {
		return nil
	}
	objects := make([]objectMap, 0, len(diagram.Shapes)+len(diagram.Connections))
	shapesByID := make(map[string]d2target.Shape, len(diagram.Shapes))
	for _, shape := range diagram.Shapes {
		shapesByID[shape.ID] = shape
		x, y := float64(shape.Pos.X), float64(shape.Pos.Y)
		w, h := float64(shape.Width), float64(shape.Height)
		link := shape.Link
		if link == "" {
			link = objectLinks[shape.ID]
		}
		objects = append(objects, objectMap{
			ID:           shape.ID,
			Kind:         "shape",
			BoardPath:    nonNilBoardPath(boardPath),
			Label:        shape.Label,
			Link:         link,
			SourceRanges: nonNilRanges(rangesForShape(shape.ID, sourceRanges, nodeScopeRanges)),
			Preview:      previewBox{X: &x, Y: &y, Width: &w, Height: &h},
		})
	}
	connectionOccurrences := map[string]int{}
	for _, conn := range diagram.Connections {
		route := make([]point, 0, len(conn.Route))
		for _, p := range conn.Route {
			if p != nil {
				route = append(route, point{X: p.X, Y: p.Y})
			}
		}
		connectionKey := conn.Src + "\x00" + conn.Dst
		connectionIndex := connectionOccurrences[connectionKey]
		connectionOccurrences[connectionKey]++
		preview := previewBox{Route: route}
		if path, ok := connectionPreviewPath(conn, shapesByID); ok {
			preview.Path = path
		}
		objects = append(objects, objectMap{
			ID:           conn.ID,
			Kind:         "connection",
			BoardPath:    nonNilBoardPath(boardPath),
			Label:        conn.Label,
			Link:         conn.Link,
			Src:          conn.Src,
			Dst:          conn.Dst,
			SourceRanges: nonNilRanges(rangesForConnection(conn.Src, conn.Dst, connectionIndex, connectionRanges, sourceRanges)),
			Preview:      preview,
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

func scanObjectLinks(source string) map[string]string {
	links := map[string]string{}
	var scopes []blockScope
	depth := 0

	for _, line := range strings.Split(source, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		if len(scopes) > 0 {
			if key, value, ok := splitD2KeyValue(trimmed); ok && strings.EqualFold(key, "link") {
				links[scopes[len(scopes)-1].id] = cleanLinkValue(value)
			}
		}
		if id, value, ok := splitD2InlineLink(trimmed); ok {
			links[qualifyScannedLinkID(scopes, id)] = cleanLinkValue(value)
		}
		if id, ok := splitD2BlockStart(trimmed); ok {
			scopes = append(scopes, blockScope{id: qualifyScannedLinkID(scopes, id), depth: depth + 1})
		}

		depth += strings.Count(trimmed, "{")
		depth -= strings.Count(trimmed, "}")
		for len(scopes) > 0 && depth < scopes[len(scopes)-1].depth {
			scopes = scopes[:len(scopes)-1]
		}
	}
	return links
}

func qualifyScannedLinkID(scopes []blockScope, id string) string {
	if len(scopes) == 0 || strings.Contains(id, ".") {
		return id
	}
	return scopes[len(scopes)-1].id + "." + id
}

func splitD2InlineLink(line string) (string, string, bool) {
	index := strings.Index(line, ".link:")
	if index < 0 {
		return "", "", false
	}
	id := strings.TrimSpace(line[:index])
	value := strings.TrimSpace(line[index+len(".link:"):])
	if id == "" || value == "" {
		return "", "", false
	}
	return strings.Trim(id, `"'`), value, true
}

func splitD2BlockStart(line string) (string, bool) {
	if !strings.HasSuffix(line, "{") {
		return "", false
	}
	key, _, ok := splitD2KeyValue(strings.TrimSuffix(line, "{"))
	if !ok || key == "" || strings.Contains(key, "->") {
		return "", false
	}
	return strings.Trim(key, `"'`), true
}

func splitD2KeyValue(line string) (string, string, bool) {
	index := strings.Index(line, ":")
	if index < 0 {
		return "", "", false
	}
	key := strings.TrimSpace(line[:index])
	value := strings.TrimSpace(line[index+1:])
	return key, value, key != ""
}

func cleanLinkValue(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimSuffix(value, ",")
	return strings.Trim(strings.TrimSpace(value), `"'`)
}

func nonNilBoardPath(boardPath []string) []string {
	if boardPath == nil {
		return []string{}
	}
	return append([]string{}, boardPath...)
}

func nodeAt(params nodeAtParams) map[string]string {
	var bestID string
	var bestRange *sourceRange
	for _, obj := range buildObjectMap(params.Source, nilFallbackDiagram(params.Source), nil) {
		for _, r := range obj.SourceRanges {
			if contains(r, params.Line, params.Column) {
				if bestRange == nil || sourceRangeSize(r) < sourceRangeSize(*bestRange) {
					bestID = obj.ID
					rangeCopy := r
					bestRange = &rangeCopy
				}
			}
		}
	}
	if bestID != "" {
		return map[string]string{"id": bestID}
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

func sourceRangeSize(r sourceRange) int {
	if r.StartLine == r.EndLine {
		return r.EndColumn - r.StartColumn
	}
	return (r.EndLine-r.StartLine)*10000 + r.EndColumn - r.StartColumn
}

func connectionPreviewPath(connection d2target.Connection, shapesByID map[string]d2target.Shape) (string, bool) {
	route := connection.Route
	if len(route) < 2 || route[0] == nil || route[len(route)-1] == nil {
		return "", false
	}
	for _, p := range route {
		if p == nil {
			return "", false
		}
	}

	srcStrokeWidth := 0
	if shape, ok := shapesByID[connection.Src]; ok {
		srcStrokeWidth = shape.StrokeWidth
	}
	dstStrokeWidth := 0
	if shape, ok := shapesByID[connection.Dst]; ok {
		dstStrokeWidth = shape.StrokeWidth
	}
	srcAdj := arrowheadAdjustment(route[1], route[0], connection.SrcArrow, connection.StrokeWidth, srcStrokeWidth)
	dstAdj := arrowheadAdjustment(route[len(route)-2], route[len(route)-1], connection.DstArrow, connection.StrokeWidth, dstStrokeWidth)

	path := []string{fmt.Sprintf("M %f %f", route[0].X+srcAdj.X, route[0].Y+srcAdj.Y)}
	if connection.IsCurve {
		if (len(route)-1)%3 != 0 {
			return linearConnectionPreviewPath(route, dstAdj), true
		}
		i := 1
		for ; i < len(route)-3; i += 3 {
			path = append(path, fmt.Sprintf("C %f %f %f %f %f %f",
				route[i].X, route[i].Y,
				route[i+1].X, route[i+1].Y,
				route[i+2].X, route[i+2].Y,
			))
		}
		path = append(path, fmt.Sprintf("C %f %f %f %f %f %f",
			route[i].X, route[i].Y,
			route[i+1].X, route[i+1].Y,
			route[i+2].X+dstAdj.X,
			route[i+2].Y+dstAdj.Y,
		))
		return strings.Join(path, " "), true
	}

	for i := 1; i < len(route)-1; i++ {
		prevSource := route[i-1]
		prevTarget := route[i]
		currTarget := route[i+1]
		prevVector := vectorBetween(prevSource, prevTarget)
		currVector := vectorBetween(prevTarget, currTarget)
		dist := math.Hypot(currTarget.X-prevTarget.X, currTarget.Y-prevTarget.Y)
		units := math.Min(float64(connection.BorderRadius), dist/2)
		prevTranslations := unitVector(prevVector).multiply(units)
		currTranslations := unitVector(currVector).multiply(units)

		path = append(path, fmt.Sprintf("L %f %f",
			prevTarget.X-prevTranslations.X,
			prevTarget.Y-prevTranslations.Y,
		))

		if units < float64(connection.BorderRadius) && i < len(route)-2 {
			nextTarget := route[i+2]
			nextVector := vector{X: nextTarget.X - currTarget.X, Y: nextTarget.Y - currTarget.Y}
			i++
			nextTranslations := unitVector(nextVector).multiply(units)
			path = append(path, fmt.Sprintf("C %f %f %f %f %f %f",
				prevTarget.X+prevTranslations.X,
				prevTarget.Y+prevTranslations.Y,
				currTarget.X-nextTranslations.X,
				currTarget.Y-nextTranslations.Y,
				currTarget.X+nextTranslations.X,
				currTarget.Y+nextTranslations.Y,
			))
		} else {
			path = append(path, fmt.Sprintf("S %f %f %f %f",
				prevTarget.X,
				prevTarget.Y,
				prevTarget.X+currTranslations.X,
				prevTarget.Y+currTranslations.Y,
			))
		}
	}

	lastPoint := route[len(route)-1]
	path = append(path, fmt.Sprintf("L %f %f", lastPoint.X+dstAdj.X, lastPoint.Y+dstAdj.Y))
	return strings.Join(path, " "), true
}

func linearConnectionPreviewPath(route []*geo.Point, dstAdj point) string {
	path := make([]string, 0, len(route))
	for i, p := range route {
		if p == nil {
			continue
		}
		x, y := p.X, p.Y
		if i == len(route)-1 {
			x += dstAdj.X
			y += dstAdj.Y
		}
		if len(path) == 0 {
			path = append(path, fmt.Sprintf("M %f %f", x, y))
		} else {
			path = append(path, fmt.Sprintf("L %f %f", x, y))
		}
	}
	return strings.Join(path, " ")
}

type vector struct {
	X float64
	Y float64
}

func vectorBetween(start, end *geo.Point) vector {
	return vector{X: end.X - start.X, Y: end.Y - start.Y}
}

func unitVector(v vector) vector {
	length := math.Hypot(v.X, v.Y)
	if length == 0 {
		return vector{}
	}
	return vector{X: v.X / length, Y: v.Y / length}
}

func (v vector) multiply(value float64) point {
	return point{X: v.X * value, Y: v.Y * value}
}

func arrowheadAdjustment(start, end *geo.Point, arrowhead d2target.Arrowhead, edgeStrokeWidth, shapeStrokeWidth int) point {
	distance := (float64(edgeStrokeWidth) + float64(shapeStrokeWidth)) / 2.0
	if arrowhead != d2target.NoArrowhead {
		distance += float64(edgeStrokeWidth)
	}
	unit := unitVector(vectorBetween(start, end))
	return point{X: unit.X * -distance, Y: unit.Y * -distance}
}

func nilFallbackDiagram(source string) *d2target.Diagram {
	diagram, _, _ := render(source, newCompileContext("", "", nil), nil)
	return diagram
}

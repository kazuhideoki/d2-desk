package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
)

func main() {
	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		write(response{Error: err.Error()})
		return
	}
	var req request
	if err := json.Unmarshal(raw, &req); err != nil {
		write(response{Error: err.Error()})
		return
	}
	result, err := handle(req)
	if err != nil {
		write(response{Error: err.Error()})
		return
	}
	write(response{Result: result})
}

func handle(req request) (any, error) {
	switch req.Method {
	case "compile":
		var params compileParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		return compile(params)
	case "format":
		var params compileParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		return format(params.Source)
	case "nodeAt":
		var params nodeAtParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		return nodeAt(params), nil
	case "renameNode":
		var params renameNodeParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		return renameNode(params)
	case "complete":
		var params completeParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		return complete(params)
	case "export":
		var params exportParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		return export(params)
	default:
		return nil, fmt.Errorf("unknown method %q", req.Method)
	}
}

func write(resp response) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(resp)
}

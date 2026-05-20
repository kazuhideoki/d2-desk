package main

import (
	"errors"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

type compileContext struct {
	inputPath string
	fs        fs.FS
}

type overlayFS struct {
	files    map[string]string
	fallback fs.FS
}

func newCompileContext(workspaceRootPath, currentFilePath string, openFiles []compileFile) compileContext {
	rootPath := cleanAbsolutePath(workspaceRootPath)
	currentPath := cleanAbsolutePath(currentFilePath)
	inputPath := "main.d2"

	if rootPath == "" && currentPath != "" {
		rootPath = filepath.Dir(currentPath)
	}
	if rootPath == "" {
		return compileContext{inputPath: inputPath}
	}

	if currentPath != "" {
		if relativePath, ok := relativePathWithin(rootPath, currentPath); ok {
			inputPath = relativePath
		} else if workspaceRootPath == "" {
			rootPath = filepath.Dir(currentPath)
			inputPath = filepath.Base(currentPath)
		}
	}

	files := make(map[string]string)
	for _, openFile := range openFiles {
		filePath := cleanAbsolutePath(openFile.Path)
		if filePath == "" {
			continue
		}
		relativePath, ok := relativePathWithin(rootPath, filePath)
		if !ok {
			continue
		}
		source := openFile.Source
		if source == "" {
			source = openFile.Contents
		}
		files[relativePath] = source
	}

	return compileContext{
		inputPath: filepath.ToSlash(inputPath),
		fs: overlayFS{
			files:    files,
			fallback: os.DirFS(rootPath),
		},
	}
}

func (ofs overlayFS) Open(name string) (fs.File, error) {
	cleanName, err := cleanImportPath(name)
	if err != nil {
		return nil, err
	}
	if source, ok := ofs.files[cleanName]; ok {
		return stringFile{name: path.Base(cleanName), reader: strings.NewReader(source), size: int64(len(source))}, nil
	}
	return ofs.fallback.Open(cleanName)
}

type stringFile struct {
	name   string
	reader *strings.Reader
	size   int64
}

func (file stringFile) Stat() (fs.FileInfo, error) {
	return stringFileInfo{name: file.name, size: file.size}, nil
}

func (file stringFile) Read(p []byte) (int, error) {
	return file.reader.Read(p)
}

func (file stringFile) Close() error {
	return nil
}

type stringFileInfo struct {
	name string
	size int64
}

func (info stringFileInfo) Name() string       { return info.name }
func (info stringFileInfo) Size() int64        { return info.size }
func (info stringFileInfo) Mode() fs.FileMode  { return 0644 }
func (info stringFileInfo) ModTime() time.Time { return time.Time{} }
func (info stringFileInfo) IsDir() bool        { return false }
func (info stringFileInfo) Sys() any           { return nil }

func cleanAbsolutePath(value string) string {
	if strings.TrimSpace(value) == "" {
		return ""
	}
	path, err := filepath.Abs(value)
	if err != nil {
		return ""
	}
	return filepath.Clean(path)
}

func relativePathWithin(rootPath, filePath string) (string, bool) {
	relativePath, err := filepath.Rel(rootPath, filePath)
	if err != nil {
		return "", false
	}
	relativePath = filepath.Clean(relativePath)
	if relativePath == "." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) || relativePath == ".." {
		return "", false
	}
	return filepath.ToSlash(relativePath), true
}

func cleanImportPath(name string) (string, error) {
	cleanName := path.Clean(filepath.ToSlash(name))
	if cleanName == "." || cleanName == ".." || strings.HasPrefix(cleanName, "../") || path.IsAbs(cleanName) {
		return "", errors.New("import path escapes workspace")
	}
	return cleanName, nil
}

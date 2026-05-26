export type PreviewFileLinkContext = {
  workspaceRootPath: string | null;
  currentFilePath: string | null;
};

const schemePattern = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const windowsDrivePattern = /^[a-zA-Z]:[\\/]/;

export function resolvePreviewFileLink(
  href: string,
  { workspaceRootPath, currentFilePath }: PreviewFileLinkContext,
) {
  const filePath = filePathFromHref(href);
  if (!filePath) return null;

  const normalizedWorkspaceRoot = workspaceRootPath ? normalizePath(workspaceRootPath) : null;
  const resolvedPath = isAbsolutePath(filePath)
    ? normalizePath(filePath)
    : normalizePath(`${baseDirectory(currentFilePath, normalizedWorkspaceRoot)}/${filePath}`);

  if (normalizedWorkspaceRoot && !isPathWithin(resolvedPath, normalizedWorkspaceRoot)) {
    return null;
  }
  return resolvedPath;
}

function filePathFromHref(href: string) {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  if (trimmed.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(trimmed).pathname);
    } catch {
      return null;
    }
  }

  if (schemePattern.test(trimmed) && !windowsDrivePattern.test(trimmed)) {
    return null;
  }

  const withoutFragment = trimmed.split("#", 1)[0] ?? "";
  return (withoutFragment.split("?", 1)[0] ?? "").trim() || null;
}

function baseDirectory(currentFilePath: string | null, workspaceRootPath: string | null) {
  if (currentFilePath) {
    return dirname(normalizePath(currentFilePath));
  }
  return workspaceRootPath ?? "";
}

function isAbsolutePath(path: string) {
  return path.startsWith("/") || windowsDrivePattern.test(path);
}

function isPathWithin(path: string, rootPath: string) {
  return path === rootPath || path.startsWith(`${rootPath}/`);
}

function dirname(path: string) {
  const index = path.lastIndexOf("/");
  if (index <= 0) return path.startsWith("/") ? "/" : "";
  return path.slice(0, index);
}

function normalizePath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const prefix = normalized.match(/^[a-zA-Z]:/)?.[0] ?? "";
  const absolute = normalized.startsWith("/") || Boolean(prefix);
  const body = prefix ? normalized.slice(prefix.length) : normalized;
  const parts: string[] = [];

  for (const part of body.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop();
      } else if (!absolute) {
        parts.push(part);
      }
      continue;
    }
    parts.push(part);
  }

  const joined = parts.join("/");
  if (prefix) return `${prefix}/${joined}`.replace(/\/$/, "");
  if (absolute) return `/${joined}`.replace(/\/$/, "") || "/";
  return joined;
}

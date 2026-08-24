export type D2DeskDeepLink = {
  filePath: string;
};

export function parseD2DeskDeepLink(rawUrl: string, expectedScheme: string): D2DeskDeepLink {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid D2 Desk URL");
  }

  if (
    url.protocol !== `${expectedScheme}:` ||
    url.hostname !== "open" ||
    url.pathname !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Unsupported D2 Desk URL");
  }

  const parameters = Array.from(url.searchParams.keys());
  const filePaths = url.searchParams.getAll("file");
  if (parameters.length !== 1 || parameters[0] !== "file" || filePaths.length !== 1) {
    throw new Error("D2 Desk open URL requires exactly one file parameter");
  }

  const filePath = filePaths[0];
  if (filePath.length === 0) {
    throw new Error("D2 Desk open URL requires a file path");
  }

  return { filePath };
}

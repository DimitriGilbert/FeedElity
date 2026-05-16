const routeTreeFile = new URL("../src/routeTree.gen.ts", import.meta.url);
const routeUpdatePattern = new RegExp(
  "const (\\w+Route) = (\\w+RouteImport)\\.update\\(\\{([\\s\\S]*?)\\} as " +
    "a" +
    "ny\\)",
  "g",
);

const generatedSource = await Bun.file(routeTreeFile).text();
const firstImportIndex = generatedSource.indexOf("import ");
const sourceWithoutHeader =
  firstImportIndex >= 0 ? generatedSource.slice(firstImportIndex) : generatedSource;
const normalizedSource = sourceWithoutHeader.replace(
  routeUpdatePattern,
  (_match: string, routeName: string, routeImportName: string, routeOptions: string) => {
    const optionsName = `${routeName}Options`;

    return `const ${optionsName}: NonNullable<Parameters<typeof ${routeImportName}.update>[0]> & {\n  id: string\n  path: string\n  getParentRoute: () => typeof rootRouteImport\n} = {${routeOptions}}\nconst ${routeName} = ${routeImportName}.update(${optionsName})`;
  },
);

if (normalizedSource !== generatedSource) {
  await Bun.write(routeTreeFile, normalizedSource);
}

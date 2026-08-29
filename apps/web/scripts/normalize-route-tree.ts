const routeTreeFile = new URL("../src/routeTree.gen.ts", import.meta.url);
const routeUpdatePattern = new RegExp(
  "const (\\w+Route) = (\\w+RouteImport)\\.update\\(\\{([\\s\\S]*?)\\} as " +
    "a" +
    "ny\\)",
  "g",
);
const parentRoutePattern = /getParentRoute: \(\) => (\w+)/;
const pathOptionPattern = /\n  path: /;

const generatedSource = await Bun.file(routeTreeFile).text();
const firstImportIndex = generatedSource.indexOf("import ");
const sourceWithoutHeader =
  firstImportIndex >= 0 ? generatedSource.slice(firstImportIndex) : generatedSource;
const normalizedSource = sourceWithoutHeader.replace(
  routeUpdatePattern,
  (_match: string, routeName: string, routeImportName: string, routeOptions: string) => {
    const optionsName = `${routeName}Options`;
    const parentMatch = parentRoutePattern.exec(routeOptions);
    if (parentMatch === null) {
      throw new Error(`No getParentRoute option found for ${routeName} in routeTree.gen.ts`);
    }
    const pathProperty = pathOptionPattern.test(routeOptions) ? "\n  path: string" : "";

    return `const ${optionsName}: NonNullable<Parameters<typeof ${routeImportName}.update>[0]> & {\n  id: string${pathProperty}\n  getParentRoute: () => typeof ${parentMatch[1]}\n} = {${routeOptions}}\nconst ${routeName} = ${routeImportName}.update(${optionsName})`;
  },
);

if (normalizedSource !== generatedSource) {
  await Bun.write(routeTreeFile, normalizedSource);
}

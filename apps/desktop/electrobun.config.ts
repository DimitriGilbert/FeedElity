import type { ElectrobunConfig } from "electrobun";

const webBuildDir = "../web/dist";

export default {
  app: {
    name: "FeedElity",
    identifier: "dev.bettertstack.FeedElity.desktop",
    version: "0.0.1",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    copy: {
      [webBuildDir]: "views/mainview",
      "../../packages/db/src/migrations": "db-migrations",
    },
    watchIgnore: [`${webBuildDir}/**`],
    mac: {
      bundleCEF: false,
      defaultRenderer: "cef",
    },
    linux: {
      bundleCEF: false,
      defaultRenderer: "cef",
    },
    win: {
      bundleCEF: false,
      defaultRenderer: "cef",
    },
  },
} satisfies ElectrobunConfig;

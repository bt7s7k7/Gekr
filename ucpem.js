/// <reference path="./.vscode/config.d.ts" />

const { project, github, run, join, constants, copy } = require("ucpem")
const { build } = require("esbuild")
const { readFile, rename, rm } = require("fs/promises")

project.prefix("src").res("gekr",
    github("bt7s7k7/CommonTypes").res("comTypes")
)

project.script("build", async () => {
    const target = join(constants.projectPath, "./dist")
    await rm(join(target), { recursive: true })

    const success = await build({
        bundle: true,
        format: "cjs",
        entryPoints: ["./src/index.ts"],
        outfile: "./dist/index.js",
        sourcemap: "external",
        logLevel: "info",
        platform: "node",
        external: [
            "kompa",
        ],
        plugins: [
            {
                name: "Externalize directory",
                setup(build) {
                    build.onLoad({ filter: /./ }, async (args) => {
                        const contents = await readFile(args.path).then(v => v.toString()
                            .replace(/\.\.\/comTypes\/[^"]+/g, "kompa")
                        )

                        return { contents, loader: "ts" }
                    })
                }
            }
        ]
    }).then(() => true, () => false)

    if (success) await run("yarn tsc")


    await rm(join(target, "./comTypes"), { recursive: true })

    await copy(target, target, {
        quiet: true,
        replacements: [
            [/\.\.\/comTypes\/[^"]+/g, "kompa"],
        ]
    })
}, { desc: "Builds the npm target" })

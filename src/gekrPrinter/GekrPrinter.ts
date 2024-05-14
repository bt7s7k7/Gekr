import { cloneWithout } from "../comTypes/util"
import { Gekr } from "../gekr/Gekr"
import { ColorName, DescriptionFormatter } from "../prettyPrint/DescriptionFormatter"
import { LogMarker, ObjectDescription } from "../prettyPrint/ObjectDescription"
import { FORMAT, Formatter } from "../textFormat/Formatter"

const _COLORS: Record<ColorName, (v: string) => string> = {
    black: FORMAT.black,
    blue: FORMAT.primary,
    cyan: FORMAT.primary,
    gray: FORMAT.secondary,
    green: FORMAT.success,
    magenta: FORMAT.bold,
    red: FORMAT.danger,
    white: FORMAT.white,
    yellow: FORMAT.warning
}

function _formatPosition(target: Gekr.Position | Gekr.Diagnostic, options: (Exclude<Parameters<Gekr.Position["format"]>[1], undefined> & { error?: boolean }) | undefined = undefined) {
    const pos = target instanceof Gekr.Diagnostic ? target.pos : target
    const error = !!options?.error
    options = {
        formatLocation: v => FORMAT[error ? "primary" : "metadata"](v, { offset: pos.offset.toString(), length: pos.length.toString() }),
        formatPointer: v => error ? FORMAT.danger(v) : v,
        formatMessage: v => error ? FORMAT.danger(v) : v,
        ...options
    }

    if (target instanceof Gekr.Diagnostic) {
        return FORMAT[error ? "white" : "primary"](target.format(options))
    } else {
        return FORMAT[error ? "white" : "primary"](target.format(null, options))
    }
}

// @ts-ignore
Gekr.Position.prototype[LogMarker.CUSTOM] = function () {
    return LogMarker.rawText(_formatPosition(this), "white", { indent: true })
}

// @ts-ignore
Gekr.Diagnostic.prototype[LogMarker.CUSTOM] = function () {
    return LogMarker.rawText(_formatPosition(this), "white", { indent: true })
}


export namespace GekrPrinter {
    export const formatPosition = _formatPosition

    export function inspect(value: any, { colors = true, singleLine = false } = {}) {
        const desc = ObjectDescription.inspectObject(value)

        return DescriptionFormatter.formatDescription(desc, {
            color: (text, color) =>
                colors == false ? text
                    : color.custom ? text
                        : _COLORS[color.name](text),
            lineLimit: singleLine ? Infinity : 50
        })
    }

    export function stringifyParsingResult(parsed: Gekr.Node, { colors = false, positionDecorator = null as ((pos: Gekr.Position) => string) | null } = {}) {
        let result = ""
        if (parsed.kind != "root") throw new TypeError("Expected root node")

        for (const node of parsed.children) {
            const visit = (node: Gekr.Node | string, indent: number, prefix = "") => {
                result += FORMAT.dark("| ".repeat(indent))
                result += prefix
                if (typeof node == "string") {
                    result += FORMAT.success(JSON.stringify(node))
                    result += "\n"
                    return
                }

                result += FORMAT.bold(node.kind)
                result += " "
                result += inspect(node.kind == "invocation" && node.target.kind == "ident" ? node.target.name
                    : cloneWithout<any>(node, "kind", "pos", "block", "target", "children", "values", "strings"), { colors, singleLine: true })
                result += " "
                result += positionDecorator ? positionDecorator(node.pos) : FORMAT.primary(node.pos.format(null, { short: true }))
                result += "\n"

                if (node.kind == "invocation") {
                    if (node.target.kind != "ident") visit(node.target, indent + 1, FORMAT.warning("(target)"))
                }

                if (node.kind == "format") {
                    for (let i = 0; i < node.strings.length; i++) {
                        visit(node.strings[i], indent + 1)
                        if (i != node.strings.length - 1) {
                            const values = node.values[i]
                            for (const value of values) {
                                visit(value, indent + 1)
                            }
                        }
                    }
                }

                if (node.kind == "label") {
                    visit(node.target, indent + 1, FORMAT.warning("(target)"))
                }

                if (Gekr.nodeHasChildren(node)) {
                    for (const child of node.children) {
                        visit(child, indent + 1)
                    }
                }

                if (node.kind == "invocation") {
                    if (node.block) visit(node.block, indent + 1, FORMAT.warning("(block)"))
                }
            }

            visit(node, 0)
        }

        if (colors) return result.trimEnd()
        else return Formatter.removeFormatting(result.trimEnd())
    }
}

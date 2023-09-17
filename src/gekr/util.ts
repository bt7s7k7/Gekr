import { GenericParser } from "../comTypes/GenericParser"
import { autoFilter, isWord } from "../comTypes/util"
import { Gekr } from "./Gekr"

export function parseDotenv<T extends object = Record<string, string>>(content: string, target: T = Object.create(null)) {
    const parser = new GenericParser(content)
    while (!parser.isDone()) {
        parser.skipUntil((v, i) => isWord(v, i) || v[i] == "#")
        if (parser.getCurrent() == "#") {
            parser.skipUntil("\n")
            continue
        }
        if (parser.isDone()) break
        const name = parser.readUntil("=").trim()
        if (parser.isDone()) break
        parser.index++
        let quote
        let value
        if ((quote = parser.consume(["\"", "'", "`"]))) {
            value = parser.readUntil(quote)
        } else {
            value = parser.readUntil((v, i) => v[i] == "\n" || v[i] == "#").trim()
            if (parser.getCurrent() == "#") {
                parser.skipUntil("\n")
            }
        }

        if (name in target) continue
        (target as any)[name] = value
    }

    return target
}

type HighlightingTargets =
    | {
        target: "codemirror5",
        overrideTokens?: { keyword?: string, atom?: string, number?: string, comment?: string, type?: string, variable?: string, string?: string, escape?: string }
    }


type HighlightingOptions = HighlightingTargets & {
    grammar: Gekr.Grammar,
    /** Primary keywords are generally declarations, for example `export`, `var`, `function` */
    primaryKeywords: string[],
    /** Secondary keywords are generally modifiers, for example `extends`, `instanceof`, `abstract` */
    secondaryKeywords: string[],
    /** Constants like `true` or `null` */
    constants: string[]
    /** Will use the `type` token type for every identifier starting with a capital letter. @default true */
    pascalCaseAsTypes?: boolean,
    /** @default true */
    highlightNumbers?: boolean
    /** @default true */
    highlightStrings?: boolean
    additionalTokens?: { regex: RegExp, token: string }[]
}
export function generateGekrHighlighting(options: HighlightingOptions): any {
    const { pascalCaseAsTypes = true, highlightNumbers = true, highlightStrings = true } = options
    if (options.target == "codemirror5") {
        const keywords = options.primaryKeywords
        const atoms = options.secondaryKeywords.concat(options.constants)
        const tokens = {
            keyword: "keyword", atom: "atom", number: "number", comment: "comment",
            type: "def", variable: "variable", string: "string", escape: "string-2",
            ...options.overrideTokens
        }

        const start = autoFilter([
            keywords.length > 0 && { regex: new RegExp(`\\b(?:${keywords.join("|")})\\b`), token: tokens.keyword },
            atoms.length > 0 && { regex: new RegExp(`\\b(?:${atoms.join("|")})\\b`), token: tokens.atom },
            highlightNumbers && { regex: /0x[a-f\d]+|0b[10]+|[-+]?(?:\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/i, token: tokens.number },
            options.additionalTokens,
            { regex: /\/\/.*/, token: tokens.comment },
            { regex: /\\\\.*/, token: tokens.string },
            { regex: /\/\*/, token: tokens.comment, push: "multi_comment" },
            { regex: /[A-Z][\w]*/, token: pascalCaseAsTypes ? tokens.type : tokens.variable },
            { regex: /[a-z_][\w]*/, token: tokens.variable },
            { regex: /[\{\[\(]/, indent: true },
            { regex: /[\}\]\)]/, dedent: true },
        ])

        const result: Record<string, any> = {
            start,
            multi_comment: [
                { regex: /\/\*/, token: tokens.comment, push: "multi_comment" },
                { regex: /\*\//, token: tokens.comment, pop: true },
                { regex: /[^*/]+/, token: tokens.comment }
            ],
            meta: {
                dontIndentStates: ["multi_comment"],
                lineComment: "//"
            }
        }

        if (highlightStrings) {
            for (const [name, sentinel] of [["double", "\""], ["single", "'"]] as const) {
                start.push({ regex: new RegExp(sentinel), token: "string", push: name })
                result[name] = [
                    { regex: new RegExp(`\\\\[nrt]`), token: tokens.escape },
                    { regex: new RegExp(`\\\\[\\\\${sentinel}]`), token: tokens.string },
                    { regex: new RegExp(sentinel), token: tokens.string, pop: true },
                    { regex: new RegExp(`[^\\\\${sentinel}]+`), token: tokens.string },
                ]
            }
        }

        return result
    } else throw new RangeError(`Invalid highlighting target ${JSON.stringify(options.target)}`)
}

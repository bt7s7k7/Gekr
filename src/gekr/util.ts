import { GenericParser } from "../comTypes/GenericParser"
import { isWord } from "../comTypes/util"

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

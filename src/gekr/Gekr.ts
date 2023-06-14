import { GenericParser } from "../comTypes/GenericParser"
import { LinkedList } from "../comTypes/LinkedList"
import { FilterBy } from "../comTypes/types"
import { isNumber, isWord, repeatString, reverseIndexOf, unreachable } from "../comTypes/util"

function isWhitespace(v: string) {
    return v == " " || v == "\t" || v == "\r"
}

export namespace Gekr {
    /** Error message produced by the parser containing a position. */
    export class Diagnostic {
        public format(options?: Parameters<Position["format"]>[1]) {
            return this.pos.format(this.message, options)
        }

        constructor(
            public readonly message: string,
            public readonly pos: Position
        ) { }
    }

    /** Representation of a parsed document. */
    export class Document {
        constructor(
            public readonly path: string,
            public readonly content: string
        ) { }
    }

    /** A range of characters in a document, used in {@link Diagnostic}. */
    export class Position {
        public format(message: string | null = null, { short = false, indent = "" } = {}) {
            const offset = this.offset
            const code = this.document.content

            const lineEnd = code.indexOf("\n", offset)
            const lineStart = reverseIndexOf(code, "\n", offset)
            const columnNum = lineStart == -1 ? offset : offset - lineStart - 1

            let tabOffset = 0
            const maxOffset = (lineEnd == undefined ? code.length : lineEnd) - lineStart
            while (tabOffset < maxOffset) {
                const char = code[lineStart + 1 + tabOffset]

                if (char == " " || char == "\t") {
                    tabOffset++
                    continue
                }

                break
            }

            const line = code.slice(lineStart + 1 + tabOffset, lineEnd == -1 ? undefined : lineEnd)
            const pointer = repeatString(" ", columnNum - tabOffset) + (this.length > 1 ? repeatString("~", this.length) : "^")

            return indent + this.document.path + ":" + (this.line + 1) + ":" + (columnNum + 1) + (message != null ? " - " + message : "") + (short ? "" : "\n" + indent + line + "\n" + indent + pointer)
        }

        constructor(
            public readonly document: Document,
            public line: number,
            public offset: number,
            public length: number,
        ) { }

        public static createSpecial(kind: string) {
            const pos = Object.create(SpecialPosition.prototype) as Position
            Object.assign(pos, { kind })
            return pos
        }
    }

    /** A position outside any parsed documents, for use later in the compilation chain (i.e. language defined constructs).*/
    class SpecialPosition extends Position {
        public readonly kind!: string

        public format(message?: string | null, options: Parameters<Position["format"]>[1] = {}): string {
            return `<${this.kind}>` + (message != null ? " - " + message : "")
        }
    }

    /** Any node in the syntax tree */
    export type Node =
        | Node.Root | Node.Block | Node.Group | Node.Tuple | Node.Ident
        | Node.Label | Node.String | Node.Number | Node.Format | Node.Operator
        | Node.Separator | Node.LabelOperator | Node.Invocation

    export namespace Node {
        interface NodeBase { pos: Position }

        /** Represents a root of the parsed document. */
        export interface Root extends NodeBase { kind: "root", children: Node[] }
        /** Represents a block of tokens in curly braces. */
        export interface Block extends NodeBase { kind: "block", children: Node[] }
        /** Represents a group of tokens in parentheses. */
        export interface Group extends NodeBase { kind: "group", children: Node[] }
        /** Represents a tuple of tokens in square brackets. */
        export interface Tuple extends NodeBase { kind: "tuple", children: Node[] }
        /** Represents an identifier. */
        export interface Ident extends NodeBase { kind: "ident", name: string }
        /** Represents a labelled node. */
        export interface Label extends NodeBase { kind: "label", label: string, target: Node }
        /** Represents a string literal. */
        export interface String extends NodeBase { kind: "string", value: string, fullLine: boolean }
        /** Represents a number literal. */
        export interface Number extends NodeBase { kind: "number", value: number }
        /** Represents a formatted string literal. */
        export interface Format extends NodeBase { kind: "format", strings: string[], values: Node[][] }
        /** Represents an operator to be bound to operands. Should not appear in a parsed syntax tree. */
        export interface Operator extends NodeBase { kind: "operator", token: string }
        /** Represents a explicit separation between tokens. */
        export interface Separator extends NodeBase { kind: "separator", strong: boolean }
        /** Represents a label to be bound to a token. Should not appear in a parsed syntax tree. */
        export interface LabelOperator extends NodeBase { kind: "label_op", name: string }
        /** Represents a function or method invocation with arguments as children. */
        export interface Invocation extends NodeBase { kind: "invocation", target: Node, children: Node[], block: Node | null }
    }

    /** All syntax tree nodes that have children */
    export type NodeWithChildren = FilterBy<Node, "children", Node[]>

    /** If this {@link Node} can be used as a target of an invocation/operator. */
    export function isNodeTarget(node: Node) {
        return node.kind != "operator" && node.kind != "separator" && node.kind != "label_op"
    }

    /** Returns true if the node has children. */
    export function nodeHasChildren(node: Node): node is NodeWithChildren {
        return "children" in node
    }

    /** Single operation in a {@link Grammar} definition step. */
    export abstract class ParserOperation {
        /** This property is used internally, do not change. When a {@link Grammar} is constructed, contains the step number, when this operation is executed. */
        public presentence: number = null!

        /** This method is called when the operation is executed. Return null if this operation does not apply here or return a {@link Node} to be inserted. */
        public abstract invoke(tokens: LinkedList<Node>, iter: LinkedList.Node<Node>, errors: Diagnostic[]): LinkedList.Node<Node> | null

        /** Return a list of operators that are processed by this operation and should not be processed by the parser. */
        public getCustomOperators(): Operator[] | null {
            return null
        }
    }

    /** Specifies where the operator is placed in relation to its operand(s). */
    export type OperatorBiding = "prefix" | "infix" | "postfix"

    /**
     * Defines an operator to be bound to operands creating an invocation.
     * Use in a {@link Grammar} definition step. This is a special subclass
     * of {@link ParserOperation}, in the sense that it does not have custom
     * behaviour and is instead directly in the parsing process, thus it cannot
     * be customized or be used in the same step as a normal operation.
     * */
    export class Operator extends ParserOperation {
        public invoke(tokens: LinkedList<Node>, iter: LinkedList.Node<Node>, errors: Diagnostic[]): LinkedList.Node<Node> | null {
            return null
        }

        constructor(
            /** Sequence of character that defines this operator. */
            public readonly token: string,
            /** Specifies where the operator is placed in relation to its operand(s). */
            public readonly binding: OperatorBiding,
            /** 
             * Name of a function to be used in the created invocation node or a custom node factory.
             * Use `null` if this operator will be only consumed by custom {@link ParserOperation}s.
             * */
            public readonly emit: ((input: Node[], pos: Position) => Node) | string | null,
        ) {
            super()
        }

        /** Creates a unique operator identification string based on its token and {@link OperatorBiding binding type}. */
        public static makeID(token: string, binding: OperatorBiding) {
            return binding == "infix" ? (
                `_${token}_`
            ) : binding == "prefix" ? (
                `${token}_`
            ) : binding == "postfix" ? (
                `_${token}`
            ) : unreachable()
        }
    }

    /** Creates a C-style function invocation. For example `target(arg1, arg2)`. */
    export class Invocation extends ParserOperation {
        public invoke(tokens: LinkedList<Node>, iter: LinkedList.Node<Node>, errors: Diagnostic[]): LinkedList.Node<Node> | null {
            const token = iter.value

            if (token.kind == this.type) {
                if (iter.prev && isNodeTarget(iter.prev.value)) {
                    if (this.target == null) {
                        const target = iter.prev.value
                        tokens.insert(iter, { kind: "invocation", block: null, children: token.children, pos: target.pos, target })
                    } else {
                        tokens.insert(iter, {
                            kind: "invocation", block: null, children: [iter.prev.value, ...token.children], pos: token.pos,
                            target: { kind: "ident", name: this.target, pos: token.pos }
                        })
                    }
                    tokens.delete(iter.prev)
                    tokens.delete(iter)
                }
            }

            return null
        }

        constructor(
            public readonly type: NodeWithChildren["kind"],
            public readonly target: string | null
        ) { super() }
    }

    /** Binds arguments to a keyword. For example `return 5`.  */
    export class KeywordBinding extends ParserOperation {
        public invoke(tokens: LinkedList<Node>, iter: LinkedList.Node<Node>, errors: Diagnostic[]): LinkedList.Node<Node> | null {
            const token = iter.value
            if (token.kind == "ident") {
                const invocation: Node = { kind: "invocation", target: token, block: null, children: [], pos: token.pos }

                let first = true
                for (let end = iter.next; end != null && ((end.value.kind == "separator" && end.value.strong) || isNodeTarget(end.value)) && end.value.kind != "block"; end = end.next) {
                    if (end.value.kind != "separator") invocation.children.push(end.value)
                    else if (first) return null
                    tokens.delete(end)
                    first = false
                }

                if (invocation.children.length == 0) return null

                const result = tokens.insert(iter, invocation)
                tokens.delete(iter)
                return result
            }

            return null
        }
    }

    export const ARROW_OPERATOR = new Operator("=>", "infix", null)
    /** Binds a block to an invocation node. For example `if(true) {...}` */
    export class BlockBinding extends ParserOperation {
        public invoke(tokens: LinkedList<Node>, iter: LinkedList.Node<Node>, errors: Diagnostic[]): LinkedList.Node<Node> | null {
            const token = iter.value
            if (!((token.kind == "invocation" && token.block == null) || token.kind == "ident" || token.kind == "group")) return null
            if (!iter.next) return null

            const toDelete: LinkedList.Node<Node>[] = []
            let block

            const specToken = iter.next.value
            if (specToken.kind == "block") {
                block = iter.next
                toDelete.push(block)
            } else if (specToken.kind == "operator") {
                if (iter.next.next == null) return null
                const arrow = iter.next
                block = iter.next.next
                toDelete.push(arrow)
                toDelete.push(block)
            } else return null

            if (token.kind == "ident") {
                tokens.insert(iter, { kind: "invocation", block: block.value, children: [], target: token, pos: token.pos })
                tokens.delete(iter)
            } else if (token.kind == "group") {
                tokens.insert(iter, { kind: "invocation", block: block.value, children: token.children, target: { kind: "ident", name: "<int>arrow", pos: token.pos }, pos: token.pos })
                tokens.delete(iter)
            } else {
                token.block = block.value
            }

            for (const node of toDelete) tokens.delete(node)
            return iter.next
        }

        public getCustomOperators(): Operator[] | null {
            return [ARROW_OPERATOR]
        }
    }

    /** Creates a labelled node. For example `label: statement`. */
    export class Labeling extends ParserOperation {
        public invoke(tokens: LinkedList<Node>, iter: LinkedList.Node<Node>, errors: Diagnostic[]): LinkedList.Node<Node> | null {
            const token = iter.value
            if (token.kind == "label_op" && iter.next != null && isNodeTarget(iter.next.value) && iter.next.value.kind != "label") {
                const target = iter.next.value
                tokens.delete(iter.next)

                const label: Node = { kind: "label", label: token.name, pos: token.pos, target }
                const labelNode = tokens.insert(iter, label)
                tokens.delete(iter)

                return labelNode
            }
            return null
        }
    }

    /** Template for defining grammars, contains basic arithmetic operators. */
    export function getArithmeticOperators(): ParserOperation[][] {
        return [
            [
                new Operator("-", "prefix", "neg")
            ],
            [
                new Operator("*", "infix", "mul"),
                new Operator("/", "infix", "div")
            ],
            [
                new Operator("+", "infix", "add"),
                new Operator("-", "infix", "sub")
            ]
        ]
    }

    /** Template for defining grammars, contains variable assignment operators. */
    export function getVariableOperators(): ParserOperation[][] {
        return [
            [
                new Operator("=", "infix", "<int>assign")
            ]
        ]
    }

    /** Template for defining grammars, contains operators, invocation, labeling, keywords and block binding. */
    export function getDefaultOperations(): ParserOperation[][] {
        return [
            [
                new Operator(".", "infix", "<int>access"),
                new Invocation("group", null),
                new Invocation("tuple", "index")
            ],
            ...getArithmeticOperators(),
            ...getVariableOperators(),
            [
                new Labeling()
            ],
            [
                new KeywordBinding()
            ],
            [
                new BlockBinding()
            ]
        ]
    }

    const parser = new GenericParser("", {
        readWord() {
            return this.readUntil((v, i) => !isWord(v, i))
        }
    })

    /** Factory for nodes created by a custom defined token in {@link Grammar} */
    export type DefinedNodeFactory = (v: Position) => Node

    /** Options for defining a {@link Grammar}. */
    export interface GrammarOptions {
        /** Sequence of operations, each element of this array contains an array of operations executed in parallel. */
        operations: ParserOperation[][]
        /** Explicitly defined tokens. Used for constants like `true`. */
        definitions?: [string, DefinedNodeFactory][]
    }

    export class Grammar {
        /** Sequence of operations, each element of this array contains an array of operations executed in parallel. @see {@link GrammarOptions.operations} */
        public readonly passes: ParserOperation[][] = []
        /** List of all {@link Operator operators} registered. @see {@link GrammarOptions.operations} */
        public readonly operatorsList: Operator[] = []
        /** List of all explicitly defined tokens. Used for constants like `true` or operators. @see {@link GrammarOptions.definitions}, @see {@link GrammarOptions.operations} */
        public readonly definedTokens: string[]
        /** All {@link Operator operators} registered, indexed by their unique ID. @see {@link GrammarOptions.operations}, {@link Operator.makeID} */
        public readonly operatorLookup = new Map<string, Operator>()
        /** All explicitly defined tokens registered, indexed by their token string. @see {@link GrammarOptions.definitions} */
        public readonly definitionLookup = new Map<string, DefinedNodeFactory>()

        constructor(options: GrammarOptions) {
            this.passes = [] as ParserOperation[][]
            let i = 0
            for (const passInput of options.operations) {
                const pass: ParserOperation[] = []
                this.passes.push(pass)

                for (const operation of passInput) {
                    operation.presentence = i
                    if (operation instanceof Operator) {
                        this.operatorsList.push(operation)
                    } else {
                        pass.push(operation)
                        const operators = operation.getCustomOperators()
                        if (operators != null) this.operatorsList.push(...operators)
                    }
                }

                i++
            }

            if (options.definitions != null) for (const [token, factory] of options.definitions) {
                this.definitionLookup.set(token, factory)
            }

            const definedTokens = [
                ...this.operatorsList.map(v => v.token),
                ...this.definitionLookup.keys()
            ]
            this.definedTokens = [...new Set(definedTokens)].sort((a, b) => b.length - a.length)

            for (const operator of this.operatorsList) {
                if (operator.emit == null) continue

                const key = Operator.makeID(operator.token, operator.binding)

                this.operatorLookup.set(key, operator)
            }
        }
    }

    function isHex(c: string) {
        if (isNumber(c)) return true
        const code = c.toLowerCase().charCodeAt(0)
        if (code >= "a".charCodeAt(0) && code <= "f".charCodeAt(0)) return true
        return false
    }

    /** Parses a {@link Document} using the provided {@link Grammar}. */
    export function parse(source: Document, grammar: Grammar, { lineOffset = 0 } = {}) {
        parser.restart(source.content)
        let line = lineOffset
        const errors: Diagnostic[] = []

        function processTokens(tokens: LinkedList<Node>) {
            for (let i = 0; i < grammar.passes.length; i++) {
                const pass = grammar.passes[i]

                iter: for (let iter = tokens.start; iter != null;) {
                    const token = iter.value

                    if (token.kind == "operator") {
                        let binding: OperatorBiding
                        const targetPrev = iter.prev != null && (isNodeTarget(iter.prev.value) || (iter.prev.value.kind == "separator" && iter.prev.value.strong == false && iter.prev.prev != null && isNodeTarget(iter.prev.prev.value)))
                        const targetNext = iter.next != null && (isNodeTarget(iter.next.value) || (iter.next.value.kind == "separator" && iter.next.value.strong == false && iter.next.next != null && isNodeTarget(iter.next.next.value)))

                        if (targetNext && targetPrev) {
                            binding = "infix"
                        } else if (targetNext) {
                            binding = "prefix"
                        } else if (targetPrev) {
                            binding = "postfix"
                        } else {
                            iter = iter.next
                            continue
                        }

                        const id = Operator.makeID(token.token, binding)
                        const operator = grammar.operatorLookup.get(id)
                        if (operator == null || operator.presentence != i) {
                            iter = iter.next
                            continue
                        }

                        let children
                        let next
                        if (binding == "prefix") {
                            let target = iter.next!
                            if (target.value.kind == "separator") {
                                tokens.delete(target)
                                target = target.next!
                            }
                            tokens.delete(iter.next!)
                            next = iter.next!
                            children = [target.value]
                        } else if (binding == "infix") {
                            let targetA = iter.prev!
                            if (targetA.value.kind == "separator") {
                                tokens.delete(targetA)
                                targetA = targetA.prev!
                            }
                            tokens.delete(iter.prev!)
                            let targetB = iter.next!
                            if (targetB.value.kind == "separator") {
                                tokens.delete(targetB)
                                targetB = targetB.next!
                            }
                            tokens.delete(iter.next!)
                            next = iter.next!
                            children = [targetA.value, targetB.value]
                        } else if (binding == "postfix") {
                            let target = iter.prev!
                            if (target.value.kind == "separator") {
                                tokens.delete(target)
                                target = target.prev!
                            }
                            tokens.delete(iter.prev!)
                            children = [target.value]
                            next = iter
                        } else unreachable()

                        if (typeof operator.emit == "function") {
                            tokens.insert(iter, operator.emit(children, token.pos))
                        } else {
                            if (operator.emit == null) unreachable("An")

                            tokens.insert(iter, {
                                kind: "invocation", block: null,
                                target: { kind: "ident", name: operator.emit, pos: token.pos },
                                children: children,
                                pos: token.pos
                            })
                        }

                        tokens.delete(iter)
                        iter = next
                        continue
                    } else {
                        for (const operation of pass) {
                            const next = operation.invoke(tokens, iter, errors)
                            if (next != null) {
                                iter = next
                                continue iter
                            }
                        }
                    }

                    iter = iter.next
                }
            }

            for (const token of tokens.keys()) {
                if (token.prev == null && token.value.kind == "separator") {
                    tokens.delete(token)
                }

                if (token.value.kind != "separator") {
                    if (token.next == null) break
                    if (token.next.value.kind == "separator") {
                        tokens.delete(token.next)
                    } else {
                        if (token.value.kind == "invocation" && token.value.block != null) {
                            // This is valid
                        } else {
                            errors.push(new Diagnostic(`Unexpected token, expected ","`, token.next.value.pos))
                        }
                    }
                }

                if (token.value.kind == "operator") {
                    errors.push(new Diagnostic("Unexpected operator", token.value.pos))
                }
            }

            return [...tokens.values()]
        }

        function parseBlock(term: string | null) {
            const tokens = new LinkedList<Node>()

            top: while (!parser.isDone()) {
                const curr = parser.getCurrent()
                const pos = new Position(source, line, parser.index, 1)

                if (parser.consume("//")) {
                    parser.readUntil((v, i) => v[i] == "\n")
                    parser.index++
                    line++
                    continue
                }

                if (parser.consume("/*")) {
                    let depth = 0
                    // eslint-disable-next-line no-constant-condition
                    while (true) {
                        parser.readUntil((v, i) => v.startsWith("/*", i) || v.startsWith("*/", i) || v[i] == "\n")
                        if (parser.getCurrent() == "\n") {
                            line++
                        } else if (parser.getCurrent() == "/") {
                            depth++
                        } else {
                            depth--
                        }

                        parser.index += 2

                        if (depth == -1) {
                            break
                        }
                    }
                    continue
                }

                for (const operator of grammar.definedTokens) {
                    if (parser.consume(operator)) {
                        const define = grammar.definitionLookup.get(operator)
                        pos.length = operator.length

                        if (define != null) {
                            tokens.push(define(pos))
                        } else {
                            tokens.push({ kind: "operator", token: operator, pos })
                        }

                        continue top
                    }
                }

                let consume
                if (isNumber(curr)) {
                    const type =
                        parser.consume("0x") ? "hex" :
                            parser.consume("0b") ? "bin" :
                                "dec"

                    let src = ""
                    let isDecimal = false
                    if (type == "dec") while (!parser.isDone() && isNumber(parser.getCurrent())) { src += parser.getCurrent(); parser.index++ }
                    if (type == "hex") while (!parser.isDone() && isHex(parser.getCurrent())) { src += parser.getCurrent(); parser.index++ }
                    if (type == "bin") while (!parser.isDone() && (parser.getCurrent() == "1" || parser.getCurrent() == "0")) { src += parser.getCurrent(); parser.index++ }

                    if (type == "dec") {
                        if (parser.consume(".")) {
                            src += "."
                            isDecimal = true
                            while (!parser.isDone() && isNumber(parser.getCurrent())) { src += parser.getCurrent(); parser.index++ }
                        }

                        if (parser.consume("e") || parser.consume("E")) {
                            src += "e"
                            isDecimal = true
                            if (parser.consume("+")) src += "+"
                            else if (parser.consume("-")) src += "-"
                            while (!parser.isDone() && isNumber(parser.getCurrent())) { src += parser.getCurrent(); parser.index++ }
                        }
                    }

                    let value = type == "dec" ? (isDecimal ? parseFloat(src) : parseInt(src))
                        : parseInt(src, type == "hex" ? 16 : 2)

                    pos.length = src.length
                    tokens.push({ kind: "number", value, pos })
                } else if (parser.consume("\\\\")) {
                    const value = parser.readUntil((v, i) => v[i] == "\n" || v[i] == "\r")
                    if (parser.getCurrent() == "\r") parser.index++
                    parser.index++
                    line++
                    if (tokens.end != null && tokens.end.value.kind == "string" && tokens.end.value.fullLine) {
                        tokens.end.value.value += "\n" + value
                    } else {
                        tokens.push({ kind: "string", value, fullLine: true, pos })
                    }
                } else if ((consume = parser.consume(["\"", "'", "$\"", "$'"]))) {
                    let value = ""
                    const values: Node[][] = []
                    const strings: string[] = []

                    let template = false

                    if (consume[0] == "$") {
                        template = true
                        consume = consume[1]
                    }

                    const term = consume

                    parser.skipUntil((v, i) => {
                        const char = v[i]

                        if (template && parser.consume("${")) {
                            strings.push(value)
                            value = ""
                            values.push(parseBlock("}"))
                            parser.index--
                            return false
                        } else if (char == "\\") {
                            parser.index++
                            if (parser.isDone()) return true
                            const escaped = parser.getCurrent()
                            if (escaped == "\\") value += "\\"
                            else if (escaped == "n") value += "\n"
                            else if (escaped == "r") value += "\r"
                            else if (escaped == "t") value += "\t"
                            else if (escaped == "\"") value += "\""

                            return false
                        } else if (char == term) {
                            parser.index++
                            return true
                        }

                        if (char == "\n") line++

                        value += char
                        return false
                    })

                    if (template) {
                        strings.push(value)
                        tokens.push({ kind: "format", strings, values, pos })
                    } else {
                        tokens.push({ kind: "string", value, fullLine: false, pos })
                    }
                } else if (curr == ":" && tokens.end != null) {
                    if (tokens.end.value.kind == "ident") {
                        const node = tokens.end
                        const ident = tokens.end.value
                        tokens.push({ kind: "label_op", name: ident.name, pos: ident.pos })
                        tokens.delete(node)
                    } else {
                        tokens.push({ kind: "separator", strong: true, pos })
                    }

                    parser.index++
                } else if (isWord(curr)) {
                    const word = parser.readWord()
                    pos.length = word.length
                    tokens.push({ kind: "ident", name: word, pos })
                } else if (curr == term) {
                    parser.index++
                    return processTokens(tokens)
                } else if (isWhitespace(curr)) {
                    parser.index++
                } else if (curr == "\n") {
                    if (tokens.end == null || tokens.end.value.kind != "separator") { // Only one separator per newlines
                        tokens.push({ kind: "separator", strong: false, pos })
                    }
                    parser.index++
                    line++
                } else if (curr == ",") {
                    if (tokens.end != null && tokens.end.value.kind == "separator") {
                        errors.push(new Diagnostic(`Unexpected ",", there is already a separator`, pos))
                    } else {
                        tokens.push({ kind: "separator", strong: true, pos })
                    }
                    parser.index++
                } else if (curr == "(") {
                    parser.index++
                    tokens.push({ kind: "group", children: parseBlock(")"), pos })
                } else if (curr == "{") {
                    parser.index++
                    tokens.push({ kind: "block", children: parseBlock("}"), pos })
                } else if (curr == "[") {
                    parser.index++
                    tokens.push({ kind: "tuple", children: parseBlock("]"), pos })
                } else {
                    parser.index++

                    const top = errors[errors.length - 1]
                    if (top && top.pos.document == pos.document && top.pos.offset == pos.offset - top.pos.length) {
                        top.pos.length++
                    } else {
                        errors.push(new Diagnostic("Unexpected character", pos))
                    }
                }
            }

            if (term != null) {
                errors.push(new Diagnostic(`Unterminated block, expected "${term}"`, new Position(source, line, parser.index, 1)))
            }

            return processTokens(tokens)
        }

        const rootNodes = parseBlock(null)
        const result: Node = { kind: "root", children: rootNodes, pos: new Position(source, lineOffset, 0, 1) }

        return { errors: errors.length > 0 ? errors : null, result }
    }
}

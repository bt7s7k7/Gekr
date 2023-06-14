# Gekr

Gekr is a generic library for defining parsers, specifically programming or domain specific languages. The included operations are geared towards C-style languages, but by defining custom operations it could be used for other languages.

```ts
const grammar = new Gekr.Grammar({
    operations: Gekr.getArithmeticOperators()
})
const doc = new Gekr.Document(path, "1 + 2 / 3")
const result = Gekr.parse(doc, grammar)
```

This library is being used here:
  - [Turing Machine Simulator](https://substitution.web.app/turing_machine)

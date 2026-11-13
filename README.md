# Regex Kiln

Compile a small regular-expression language into a Thompson NFA, replay the active state sets, inspect transitions, and export the machine. The matcher explores reachable states together rather than recursively backtracking over alternatives.

![Regex Kiln state inspector](docs/workbench.png)

## Interface

Pattern and input editing sit beside a state inspector. Machine, Test corpus, and Transitions & files use separate views, while the complete-input verdict remains visible above them. Filled state buttons mark reachability, a circular state marks acceptance, and an outlined state is selected for inspection. The editor stacks above results on narrow screens.

## Run

```sh
python run.py --port 8000
```

Requires Python 3.10+ and a modern browser with module workers. Open http://127.0.0.1:8000. No runtime dependencies or external services.

```sh
npm test
npm run check
python -m unittest discover -s tests -p 'test_*.py'
```

Development checks use Node 22+. CI runs on Linux and Windows.

## Features

- Recursive-descent parser with explicit syntax errors and group-depth limits.
- Thompson-style epsilon NFA construction with inspectable predicates and transitions.
- Full-string matching over Unicode code points, including empty-input behavior.
- Character-by-character replay, keyboard-selectable states and separate prefix/full-input acceptance.
- Test corpus evaluation, JSON study/evidence exports and Graphviz DOT export.
- Background worker execution and bounded inputs; no JavaScript `RegExp` is used by the application matcher.
- Three examples: alternation/repetition, Unicode classes and optional-chain stress behavior.

The default `(ab|a)+c?` study accepts `abaabc`. Its machine has 18 states; matching visits seven prefix configurations with 102 counted edge checks. The optional-chain example has 182 states and accepts thirty `a` characters using 4,246 counted edge checks. These counts are deterministic instrumentation, not timing benchmarks.

## Supported language

| Syntax                          | Meaning                               |
| ------------------------------- | ------------------------------------- |
| `abc`                           | Literal concatenation                 |
| `(a\|b)`                        | Grouped alternation                   |
| `a*`, `a+`, `a?`                | Zero-or-more, one-or-more, optional   |
| `.`                             | Any code point, **including newline** |
| `[a-z]`, `[^a-z]`               | Inclusive ranges or their complement  |
| `\n`, `\r`, `\t`                | Newline, carriage return, tab         |
| `\*`, `\[`, `\\`                | Escaped literal punctuation           |
| empty pattern/group/alternative | Empty-string match                    |

Character classes can contain literal code points or ranges. Escape a hyphen when it should always be literal. Whitespace outside a class is also literal. No implicit Unicode normalization, case folding or grapheme segmentation occurs.

Unsupported constructs are rejected: anchors, counted repetition, backreferences, lookarounds, shorthand classes such as `\d`, lazy/stacked quantifiers, flags and capture semantics. Parentheses group without capturing. This engine performs full-string matching, not substring search. Dot's newline behavior is deliberate and differs from the default in many engines.

Patterns are limited to 256 code points/512 UTF-16 units, group nesting to 32, NFA size to 1024 states, inspected text to 2000 code points/4000 UTF-16 units, and the corpus to 50 strings totaling 5000 code points. Imports are at most 100 KB. Results and exports describe the last successful compilation; changing form text requires compiling again.

## Mechanics and complexity

Each input character advances consuming edges from the current epsilon closure. A visited set prevents epsilon cycles from looping, and state sets are emitted in numeric order using a linear state scan. Core matching has O(pattern size × input length) work. Character-class range tests are included in this asymptotic bound, but the displayed **edge checks** count only closure edge inspections plus consuming-edge predicate tests, not every range comparison or bookkeeping operation.

Matching without a trace uses O(states) working memory. Retaining every prefix configuration for inspection takes O(states × input length) space. This educational implementation keeps an intentionally simple graph representation; it is not an optimized production engine or a promise about every browser's runtime behavior.

`core.js` contains parsing, compilation, matching and DOT serialization. `worker.js` runs compilation and corpus analysis away from the UI thread. `app.js` manages the last successful report and inspection state. `run.py` serves only explicitly allowed static assets on loopback.

## Verification

Ten Node tests cover empty expressions, epsilon cycles, Unicode, classes, syntax rejection, full-input anchoring, bounds, DOT/JSON exports and optional-chain work bounds. Three hundred generated patterns are checked on twenty strings each against the native JavaScript engine using compatible full-match and Unicode/dot semantics. A separate graph-reachability implementation verifies the default trace. A Python test checks static serving, Host validation and response headers.

Browser checks exercised keyboard state selection, Unicode code-point positions, the optional-chain example, unsupported backreference rejection and JSON/DOT downloads. Independent Python replay verified all seven exported active-state sets, 102 edge checks and every DOT transition.

The construction follows the concepts explained in [Russ Cox's introduction to Thompson NFA matching](https://swtch.com/~rsc/regexp/regexp1.html). This repository contains its own small implementation.

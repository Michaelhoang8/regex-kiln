export const example = {
  pattern: "(ab|a)+c?",
  text: "abaabc",
  cases: ["", "a", "ab", "abaabc", "abb", "abaac", "🙂"],
};
export function parse(pattern) {
  if (
    typeof pattern !== "string" ||
    [...pattern].length > 256 ||
    pattern.length > 512
  )
    throw Error("Pattern limit: 256 Unicode code points.");
  const chars = [...pattern];
  let pos = 0,
    depth = 0;
  const fail = (message) => {
    throw Error(`${message} At code-point offset ${pos}.`);
  };
  function escaped() {
    if (pos >= chars.length) fail("Trailing escape.");
    const c = chars[pos++];
    if (c === "n") return "\n";
    if (c === "r") return "\r";
    if (c === "t") return "\t";
    if ("\\.|()[]*+?^$-{}".includes(c)) return c;
    fail(
      "Unsupported escape; use literal characters, escaped punctuation, or n/r/t.",
    );
  }
  function atom() {
    const c = chars[pos++];
    if (c === "(") {
      if (++depth > 32) fail("Group nesting limit: 32.");
      const node = alternate();
      if (chars[pos++] !== ")") fail("Missing closing parenthesis.");
      depth--;
      return node;
    }
    if (c === "[") {
      let negate = false;
      if (chars[pos] === "^") {
        negate = true;
        pos++;
      }
      const entries = [];
      while (pos < chars.length && chars[pos] !== "]") {
        let value = chars[pos++],
          quoted = false;
        if (value === "\\") {
          value = escaped();
          quoted = true;
        }
        entries.push({ value, quoted });
      }
      if (chars[pos++] !== "]" || !entries.length)
        fail("Unclosed or empty character class.");
      const ranges = [];
      for (let i = 0; i < entries.length; i++) {
        const lo = entries[i].value.codePointAt(0);
        if (
          i + 2 < entries.length &&
          entries[i + 1].value === "-" &&
          !entries[i + 1].quoted
        ) {
          const hi = entries[i + 2].value.codePointAt(0);
          if (lo > hi) fail("Descending character range.");
          ranges.push([lo, hi]);
          i += 2;
        } else ranges.push([lo, lo]);
      }
      return { kind: "class", negate, ranges };
    }
    if (c === ".") return { kind: "any" };
    if (c === "\\") return { kind: "literal", value: escaped() };
    if ("*+?)]^${}".includes(c))
      fail("Unexpected or unsupported operator; escape it for a literal.");
    return { kind: "literal", value: c };
  }
  function repeat() {
    let node = atom();
    if (["*", "+", "?"].includes(chars[pos])) {
      node = { kind: chars[pos++], child: node };
      if (["*", "+", "?"].includes(chars[pos]))
        fail("Stacked or lazy quantifiers are unsupported.");
    }
    return node;
  }
  function concat() {
    const children = [];
    while (pos < chars.length && !["|", ")"].includes(chars[pos]))
      children.push(repeat());
    return children.length
      ? children.length === 1
        ? children[0]
        : { kind: "concat", children }
      : { kind: "empty" };
  }
  function alternate() {
    const children = [concat()];
    while (chars[pos] === "|") {
      pos++;
      children.push(concat());
    }
    return children.length === 1
      ? children[0]
      : { kind: "alternate", children };
  }
  const ast = alternate();
  if (pos !== chars.length) fail("Unexpected closing parenthesis.");
  return ast;
}
export function compile(pattern) {
  const ast = parse(pattern),
    states = [];
  const state = () => {
    if (states.length >= 1024) throw Error("Automaton state limit: 1024.");
    states.push({ id: states.length, edges: [] });
    return states.length - 1;
  };
  const edge = (from, to, test = null) => states[from].edges.push({ to, test });
  function build(node) {
    const start = state(),
      end = state();
    if (node.kind === "empty") edge(start, end);
    else if (["literal", "class", "any"].includes(node.kind))
      edge(start, end, node);
    else if (node.kind === "concat") {
      let previous = start;
      for (const child of node.children) {
        const f = build(child);
        edge(previous, f.start);
        previous = f.end;
      }
      edge(previous, end);
    } else if (node.kind === "alternate") {
      for (const child of node.children) {
        const f = build(child);
        edge(start, f.start);
        edge(f.end, end);
      }
    } else {
      const f = build(node.child);
      edge(start, f.start);
      edge(f.end, end);
      if (node.kind === "*" || node.kind === "?") edge(start, end);
      if (node.kind === "*" || node.kind === "+") edge(f.end, f.start);
    }
    return { start, end };
  }
  const fragment = build(ast);
  return { pattern, ast, states, start: fragment.start, accept: fragment.end };
}
function matches(test, char) {
  if (test.kind === "any") return true;
  if (test.kind === "literal") return test.value === char;
  const cp = char.codePointAt(0),
    inside = test.ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
  return test.negate ? !inside : inside;
}
export function match(machine, text, { trace = true } = {}) {
  if (typeof text !== "string" || [...text].length > 2000 || text.length > 4000)
    throw Error("Text limit: 2000 Unicode code points.");
  let checks = 0,
    closureChecks = 0,
    characterChecks = 0;
  const closure = (seeds) => {
    const seen = new Set(),
      stack = [...seeds];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      for (const edge of machine.states[id].edges) {
        checks++;
        closureChecks++;
        if (edge.test === null) stack.push(edge.to);
      }
    }
    return machine.states.filter((s) => seen.has(s.id)).map((s) => s.id);
  };
  let active = closure([machine.start]);
  const rows = trace
    ? [
        {
          position: 0,
          char: null,
          active: [...active],
          accepting: active.includes(machine.accept),
          checks,
        },
      ]
    : [];
  let position = 0,
    maxActive = active.length;
  for (const char of text) {
    const targets = new Set();
    for (const id of active)
      for (const edge of machine.states[id].edges)
        if (edge.test !== null) {
          checks++;
          characterChecks++;
          if (matches(edge.test, char)) targets.add(edge.to);
        }
    active = closure(targets);
    maxActive = Math.max(maxActive, active.length);
    position++;
    if (trace)
      rows.push({
        position,
        char,
        active: [...active],
        accepting: active.includes(machine.accept),
        checks,
      });
  }
  return {
    text,
    accepted: active.includes(machine.accept),
    length: position,
    checks,
    closureChecks,
    characterChecks,
    maxActive,
    rows,
  };
}
export function analyze(raw) {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray(raw.cases) ||
    raw.cases.length > 50 ||
    raw.cases.some((x) => typeof x !== "string" || [...x].length > 2000) ||
    raw.cases.reduce((n, x) => n + [...x].length, 0) > 5000
  )
    throw Error("Use at most 50 test strings and 5000 total test code points.");
  const machine = compile(raw.pattern),
    result = match(machine, raw.text);
  return {
    format: "regex-kiln-evidence-v1",
    input: { pattern: raw.pattern, text: raw.text, cases: [...raw.cases] },
    machine,
    result,
    cases: raw.cases.map((text) => match(machine, text, { trace: false })),
  };
}
export function edgeLabel(test) {
  if (!test) return "ε";
  if (test.kind === "any") return "ANY";
  if (test.kind === "literal") return JSON.stringify(test.value);
  return `${test.negate ? "NOT " : ""}[${test.ranges.map(([a, b]) => (a === b ? String.fromCodePoint(a) : `${String.fromCodePoint(a)}–${String.fromCodePoint(b)}`)).join("")}]`;
}
export function dot(machine) {
  const lines = [
    "digraph NFA {",
    "  rankdir=LR;",
    "  entry [shape=point];",
    `  entry -> s${machine.start};`,
  ];
  for (const s of machine.states) {
    lines.push(
      `  s${s.id} [shape=${s.id === machine.accept ? "doublecircle" : "circle"},label="${s.id}"];`,
    );
    for (const e of s.edges)
      lines.push(
        `  s${s.id} -> s${e.to} [label=${JSON.stringify(edgeLabel(e.test))}];`,
      );
  }
  return lines.concat("}").join("\n");
}

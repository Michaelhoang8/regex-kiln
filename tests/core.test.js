import test from "node:test";
import assert from "node:assert/strict";
import { parse, compile, match, analyze, example, dot } from "../core.js";
const accepts = (p, t) => match(compile(p), t).accepted;
test("example full match and prefix acceptance are distinct", () => {
  const r = analyze(example);
  assert.ok(r.result.accepted);
  assert.equal(r.result.rows.length, 7);
  assert.deepEqual(
    r.cases.map((x) => x.accepted),
    [false, true, true, true, false, true, false],
  );
});
test("epsilon alternatives and repetitions terminate through epsilon cycles", () => {
  for (const p of ["", "()", "a*", "(a?)*", "(a|)*", "a|"])
    assert.ok(accepts(p, ""));
  assert.ok(accepts("(a?)*", "aaa"));
  assert.ok(!accepts("(a?)*", "b"));
  assert.ok(!accepts("a+", ""));
});
test("Unicode code points, newline wildcard, escaped punctuation and ranges", () => {
  assert.ok(accepts("🙂+", "🙂🙂"));
  assert.equal(match(compile("🙂+"), "🙂🙂").length, 2);
  assert.ok(accepts(".", "\n"));
  assert.ok(accepts("[a-c]+", "cab"));
  assert.ok(accepts("[^a-c]+", "xyz🙂"));
  assert.ok(!accepts("[^a-c]+", "xay"));
  assert.ok(accepts("\\[\\]\\*", "[]*"));
  assert.ok(accepts("[\\-a]+", "-a"));
  assert.ok(accepts("\\n\\t", "\n\t"));
});
test("unsupported syntax fails explicitly", () => {
  for (const p of [
    "[",
    "[]",
    "[z-a]",
    "(",
    "a)",
    "a**",
    "a+?",
    "\\d",
    "a{2}",
    "^a",
    "a$",
    "\\",
    "*a",
  ])
    assert.throws(() => parse(p), undefined, p);
});
test("matching is anchored to the entire text", () => {
  assert.ok(!accepts("a", "ab"));
  assert.ok(!accepts("a", "ba"));
  assert.ok(!accepts("a", "a\n"));
  assert.ok(accepts("a|ab", "ab"));
});
test("bounds reject excessive input before simulation", () => {
  assert.throws(() => compile("a".repeat(257)));
  assert.throws(() => compile("(".repeat(33) + "a" + ")".repeat(33)));
  assert.throws(() => match(compile("a*"), "a".repeat(2001)));
  assert.throws(() => analyze({ ...example, cases: Array(51).fill("") }));
});
test("generated regular expressions match an independent JavaScript engine", () => {
  let seed = 73;
  const rand = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const pattern = (depth) => {
    if (!depth) return ["a", "b", "[ab]", "[^b]", ".", ""][rand(6)];
    switch (rand(4)) {
      case 0:
        return `(${pattern(depth - 1)}|${pattern(depth - 1)})`;
      case 1:
        return `(${pattern(depth - 1)})${["*", "+", "?"][rand(3)]}`;
      default:
        return pattern(depth - 1) + pattern(depth - 1);
    }
  };
  for (let i = 0; i < 300; i++) {
    const p = pattern(3),
      machine = compile(p),
      reference = new RegExp(`^(?:${p})$(?![\\s\\S])`, "us");
    for (let j = 0; j < 20; j++) {
      const text = Array.from(
        { length: rand(8) },
        () => ["a", "b", "c", "\n", "🙂"][rand(5)],
      ).join("");
      assert.equal(
        match(machine, text, { trace: false }).accepted,
        reference.test(text),
        JSON.stringify({ p, text }),
      );
    }
  }
});
test("adversarial optional chains have bounded state-set work", () => {
  for (const n of [10, 20, 40, 80]) {
    const m = compile("a?".repeat(n) + "a".repeat(n)),
      r = match(m, "a".repeat(n));
    assert.ok(r.accepted);
    const edges = m.states.reduce((sum, s) => sum + s.edges.length, 0);
    assert.ok(r.checks <= (2 * n + 1) * edges);
    assert.ok(r.maxActive <= m.states.length);
  }
});
test("closures and trace targets agree with independent graph reachability", () => {
  const m = compile("(ab|a)+c?"),
    r = match(m, "abaabc");
  const closure = (seeds) => {
    const seen = new Set(seeds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of [...seen])
        for (const e of m.states[id].edges)
          if (e.test === null && !seen.has(e.to)) {
            seen.add(e.to);
            changed = true;
          }
    }
    return [...seen].sort((a, b) => a - b);
  };
  let active = closure([m.start]);
  assert.deepEqual(r.rows[0].active, active);
  for (let i = 1; i < r.rows.length; i++) {
    const char = r.rows[i].char;
    active = closure(
      active.flatMap((id) =>
        m.states[id].edges
          .filter((e) => e.test?.kind === "literal" && e.test.value === char)
          .map((e) => e.to),
      ),
    );
    assert.deepEqual(r.rows[i].active, active);
  }
});
test("DOT and JSON exports preserve all states and transitions", () => {
  const r = analyze(example);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  const text = dot(r.machine);
  assert.ok(text.includes(`s${r.machine.accept} [shape=doublecircle`));
  assert.equal(
    (text.match(/ -> /g) || []).length,
    1 + r.machine.states.reduce((n, s) => n + s.edges.length, 0),
  );
});

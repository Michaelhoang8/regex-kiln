import { example, edgeLabel, dot } from "./core.js";
const $ = (id) => document.getElementById(id),
  esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let report = null,
  step = 0,
  selected = 0,
  timer = null,
  worker = null;
function stop() {
  clearInterval(timer);
  timer = null;
  $("play").textContent = "Play";
}
function fill(input) {
  $("pattern").value = input.pattern;
  $("text").value = input.text;
  $("cases").value = JSON.stringify(input.cases, null, 2);
}
function setBusy(value) {
  for (const button of document.querySelectorAll("button"))
    button.disabled = value;
  for (const id of ["export", "save", "dot"]) $(id).disabled = value || !report;
  $("step").disabled = value || !report;
  $("preset").disabled = value;
}
function run(input) {
  stop();
  worker?.terminate();
  setBusy(true);
  $("message").textContent = "Compiling and matching…";
  worker = new Worker("./worker.js", { type: "module" });
  worker.onmessage = ({ data }) => {
    worker.terminate();
    worker = null;
    setBusy(false);
    if (data.error) {
      $("message").textContent = data.error;
      if (report) render();
      return;
    }
    report = data.result;
    setBusy(false);
    step = 0;
    selected = report.machine.start;
    $("message").textContent =
      "Compiled successfully. Results describe the last compiled study.";
    render();
  };
  worker.onerror = () => {
    worker?.terminate();
    worker = null;
    setBusy(false);
    $("message").textContent = "The worker failed. Try a smaller study.";
    if (report) render();
  };
  worker.postMessage(input);
}
function render() {
  const { machine, result } = report,
    row = result.rows[step];
  $("verdict").textContent = result.accepted ? "Accepted" : "Rejected";
  $("verdict").dataset.accepted = String(result.accepted);
  $("states-count").textContent = machine.states.length;
  $("checks").textContent = result.checks.toLocaleString();
  $("maximum").textContent = result.maxActive;
  $("step").max = result.length;
  $("step").value = step;
  $("position").textContent = `${step} / ${result.length}`;
  $("back").disabled = step === 0;
  $("next").disabled = step === result.length;
  $("play").disabled = result.length === 0;
  $("step").disabled = result.length === 0;
  $("prefix").textContent =
    `Consumed: ${JSON.stringify([...result.text].slice(Math.max(0, step - 70), step).join(""))}${step > 70 ? " (last 70 code points)" : ""}`;
  $("prefix-status").textContent =
    `${row.active.length} active · ${row.checks} checks · prefix ${row.accepting ? "accepts" : "does not accept"}`;
  const active = new Set(row.active);
  $("states").innerHTML = machine.states
    .map(
      (s) =>
        `<button data-state="${s.id}" class="${active.has(s.id) ? "active " : ""}${selected === s.id ? "selected " : ""}${s.id === machine.accept ? "accept" : ""}" aria-label="State ${s.id}${active.has(s.id) ? ", active" : ""}${s.id === machine.accept ? ", accepting" : ""}" aria-pressed="${selected === s.id}">${s.id}</button>`,
    )
    .join("");
  const state = machine.states[selected];
  $("state-title").textContent = `State ${selected}`;
  $("state-role").textContent =
    `${selected === machine.start ? "Start state. " : ""}${selected === machine.accept ? "Accepting state. " : ""}${active.has(selected) ? "Reachable at this prefix." : "Not reachable at this prefix."}`;
  $("edges").innerHTML =
    state.edges
      .map((e) => `<div>${esc(edgeLabel(e.test))} → state ${e.to}</div>`)
      .join("") || "<div>No outgoing transitions.</div>";
  $("case-results").innerHTML = report.cases
    .map(
      (r) =>
        `<tr><td>${esc(JSON.stringify(r.text))}</td><td>${r.accepted ? "accept" : "reject"}</td><td>${r.length}</td><td>${r.checks}</td></tr>`,
    )
    .join("");
  $("transitions").innerHTML = machine.states
    .flatMap((s) =>
      s.edges.map(
        (e) =>
          `<tr><td>${s.id}</td><td>${esc(edgeLabel(e.test))}</td><td>${e.to}</td></tr>`,
      ),
    )
    .join("");
}
$("study").onsubmit = (e) => {
  e.preventDefault();
  try {
    run({
      pattern: $("pattern").value,
      text: $("text").value,
      cases: JSON.parse($("cases").value),
    });
  } catch (error) {
    $("message").textContent = error.message;
  }
};
$("study").oninput = () => {
  $("message").textContent = "Draft changed. Compile to update the results.";
};
$("cases").oninput = () => {
  $("message").textContent =
    "Test corpus changed. Compile to update the results.";
};
$("preset").onchange = () => {
  const which = $("preset").value,
    input =
      which === "default"
        ? example
        : which === "unicode"
          ? {
              pattern: "[🙂🙃]+!",
              text: "🙂🙃🙂!",
              cases: ["🙂!", "🙃🙃!", "🙂", "!", "🙂x!"],
            }
          : {
              pattern: "a?".repeat(30) + "a".repeat(30),
              text: "a".repeat(30),
              cases: [
                "a".repeat(29),
                "a".repeat(30),
                "a".repeat(60),
                "a".repeat(61),
              ],
            };
  fill(input);
  run(input);
};
function move(value) {
  if (!report) return;
  stop();
  step = Number(value);
  render();
}
$("step").oninput = (e) => move(e.target.value);
$("back").onclick = () => move(step - 1);
$("next").onclick = () => move(step + 1);
$("states").onclick = (e) => {
  const button = e.target.closest("[data-state]");
  if (button) {
    selected = Number(button.dataset.state);
    render();
    $("states").querySelector(`[data-state="${selected}"]`)?.focus();
  }
};
$("play").onclick = () => {
  if (timer) {
    stop();
    return;
  }
  if (!report || !report.result.length) return;
  if (step === report.result.length) step = 0;
  $("play").textContent = "Pause";
  render();
  timer = setInterval(() => {
    step++;
    render();
    if (step === report.result.length) stop();
  }, 600);
};
function download(name, value, type = "application/json") {
  const url = URL.createObjectURL(
      new Blob(
        [type === "application/json" ? JSON.stringify(value, null, 2) : value],
        { type },
      ),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("save").onclick = () => download("regex-kiln-study.json", report.input);
$("export").onclick = () =>
  download("regex-kiln-evidence.json", {
    ...report,
    inspection: { step, selected },
  });
$("dot").onclick = () =>
  download(
    "regex-kiln-automaton.dot",
    dot(report.machine),
    "text/vnd.graphviz",
  );
$("open").onclick = () => $("file").click();
$("file").onchange = async () => {
  try {
    const file = $("file").files[0];
    if (!file) return;
    if (file.size > 100000) throw Error("Study files must be under 100 KB.");
    const input = JSON.parse(await file.text());
    fill(input);
    run(input);
  } catch (error) {
    $("message").textContent = error.message;
  } finally {
    $("file").value = "";
  }
};
fill(example);
run(example);

for (const button of document.querySelectorAll("[data-view]"))
  button.onclick = () => {
    stop();
    for (const tab of document.querySelectorAll("[data-view]"))
      tab.setAttribute("aria-pressed", String(tab === button));
    for (const name of ["machine", "corpus", "transitions"])
      $(name + "-view").hidden = name !== button.dataset.view;
  };

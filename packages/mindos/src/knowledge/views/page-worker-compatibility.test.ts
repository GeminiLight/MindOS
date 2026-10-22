import { expect, it } from "vitest";
import { checkPageWorkerCompatibility } from "./page-worker-compatibility.js";

const html = (code: string) => `<script type="mindos/page">${code}</script>`;

it("accepts data-driven rendering and ignores ordinary markup and disabled scripts", () => {
  expect(() =>
    checkPageWorkerCompatibility(
      "card",
      html(
        "const n=(state.n||0)+(event?.id==='more'?1:0);render('<p>'+data.records.length+'</p>',{n});",
      ),
    ),
  ).not.toThrow();
  expect(() =>
    checkPageWorkerCompatibility(
      "card",
      "<p>document.querySelector</p><script>document.body</script>",
    ),
  ).not.toThrow();
});

it("distinguishes comments, strings, regex literals and template text from executable references", () => {
  const code =
    "// document.body\n/* window.alert() */\nconst text='document.querySelector';const pattern=/document[.]body/g;render(`window.alert ${data.records.length}`);";
  expect(() => checkPageWorkerCompatibility("card", html(code))).not.toThrow();
  expect(() =>
    checkPageWorkerCompatibility("card", html("render(`${document.title}`);")),
  ).toThrow(/document/);
});

it("reports the real DOM reference with its block and line instead of executing the code", () => {
  expect(() =>
    checkPageWorkerCompatibility(
      "card",
      html("while(true){}\nvar html=document.querySelector?'':'';"),
    ),
  ).toThrow(/card.*line 2.*document/);
  expect(() =>
    checkPageWorkerCompatibility("card", html('globalThis["document"].body;')),
  ).toThrow(/document/);
});

it("does not mistake local variables, destructured parameters, or object properties for globals", () => {
  const code =
    "const document={title:'local'};function show({window},fetch){return window.title+fetch();}const record={document:document.title};render(record.document+data.records[0].fields.document);";
  expect(() => checkPageWorkerCompatibility("card", html(code))).not.toThrow();
  expect(() =>
    checkPageWorkerCompatibility(
      "card",
      html(
        "function local(document){return document.title;}render(document.title);",
      ),
    ),
  ).toThrow(/document/);
  expect(() =>
    checkPageWorkerCompatibility(
      "card",
      html("function local(){var document={};}render(document.title);"),
    ),
  ).toThrow(/document/);
  expect(() =>
    checkPageWorkerCompatibility(
      "card",
      html("if(typeof document==='undefined')render('Worker');"),
    ),
  ).not.toThrow();
});

it("rejects syntax errors and obvious APIs outside the page program contract", () => {
  for (const code of [
    "const =;",
    "await fetch('/api');",
    "import('x');",
    "addEventListener('click',()=>{});",
    "self.onmessage=()=>{};",
  ]) {
    expect(() => checkPageWorkerCompatibility("card", html(code))).toThrow();
  }
  expect(() =>
    checkPageWorkerCompatibility("card", html("const document = {")),
  ).toThrow(/syntax/i);
});

it("ignores commented-out programs and checks multiple programs together", () => {
  expect(() =>
    checkPageWorkerCompatibility(
      "card",
      "<!--" + html("document.body") + "--><p>safe</p>",
    ),
  ).not.toThrow();
  expect(() =>
    checkPageWorkerCompatibility(
      "card",
      html("const document={title:'local'};") + html("render(document.title);"),
    ),
  ).not.toThrow();
});

it("handles script attributes and escaped identifiers without scanning plain HTML as JavaScript", () => {
  expect(() =>
    checkPageWorkerCompatibility(
      "card",
      '<script data-label="document > window" type=\'mindos/page\'>render("document");</script>',
    ),
  ).not.toThrow();
  expect(() =>
    checkPageWorkerCompatibility(
      "card",
      "<SCRIPT TYPE=mindos/page>doc\\u0075ment.body;</SCRIPT>",
    ),
  ).toThrow(/document/);
  expect(() =>
    checkPageWorkerCompatibility(
      "card",
      '<script type="text/plain" type="mindos/page">document.body;</script>',
    ),
  ).not.toThrow();
});

it("keeps block, loop, catch and function bindings within their own scopes", () => {
  expect(() =>
    checkPageWorkerCompatibility(
      "card",
      html(
        "for(const document of data.records){render(document.fields.title);}render(document.title);",
      ),
    ),
  ).toThrow(/document/);
  expect(() =>
    checkPageWorkerCompatibility(
      "card",
      html(
        "try{throw 'local';}catch(document){render(document);}render(document.title);",
      ),
    ),
  ).toThrow(/document/);
  expect(() =>
    checkPageWorkerCompatibility(
      "card",
      html(
        "const read=({document: local, window = 'local'})=>local+window;render(read({document:'ok'}));",
      ),
    ),
  ).not.toThrow();
});

import { parse } from "acorn";

type Ast = {
  type: string;
  name?: string;
  loc?: { start: { line: number } };
  [key: string]: unknown;
};
type Scope = { parent?: Scope; names: Set<string>; functionScope: boolean };
type Reference = { node: Ast; scope: Scope; name: string };
const unsupported = new Set([
  "document",
  "window",
  "parent",
  "top",
  "frames",
  "localStorage",
  "sessionStorage",
  "HTMLElement",
  "Element",
  "Node",
  "DOMParser",
  "MutationObserver",
  "ResizeObserver",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "Worker",
  "SharedWorker",
  "importScripts",
  "addEventListener",
  "removeEventListener",
  "onmessage",
  "postMessage",
]);

export class PageWorkerCompatibilityError extends Error {}

/** A generation-quality diagnostic, not a security boundary or proof of correctness.
 * Parses only; never evaluates model-authored programs. The browser sandbox remains authoritative.
 */
export function checkPageWorkerCompatibility(
  blockId: string,
  html: string,
): void {
  const scripts: string[] = [];
  const markup = html.replace(/<!--[\s\S]*?-->/g, "");
  const tags =
    /<script\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of markup.matchAll(tags)) {
    const attributes = (match[1] ?? "").matchAll(
      /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
    );
    for (const attribute of attributes) {
      if (attribute[1]?.toLowerCase() !== "type") continue;
      if ((attribute[2] ?? attribute[3] ?? attribute[4]) === "mindos/page")
        scripts.push(match[2] ?? "");
      break; // HTML uses the first duplicate attribute.
    }
  }
  if (!scripts.length) return;
  const fail = (line: number, reason: string): never => {
    throw new PageWorkerCompatibilityError(
      `Block ${blockId}, line ${line}: ${reason}. Page programs use data, state, event and render(html, nextState); no DOM, network, imports or custom event handlers.`,
    );
  };
  let tree: Ast;
  try {
    tree = parse(scripts.join("\n"), {
      ecmaVersion: "latest",
      sourceType: "script",
      locations: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
    }) as unknown as Ast;
  } catch (error) {
    const detail = error as { loc?: { line: number }; message?: string };
    return fail(
      detail.loc?.line ?? 1,
      "Invalid JavaScript syntax: " +
        (detail.message ?? "parse error").slice(0, 120),
    );
  }
  const references: Reference[] = [];
  const members: Array<{
    node: Ast;
    scope: Scope;
    object: string;
    property: string;
  }> = [];
  const child = (value: unknown): Ast => value as Ast;
  const scope = (parent?: Scope, functionScope = false): Scope => ({
    parent,
    functionScope,
    names: new Set(),
  });
  const bound = (name: string, current?: Scope): boolean =>
    !!current && (current.names.has(name) || bound(name, current.parent));
  function bind(pattern: Ast | undefined, current: Scope): void {
    if (!pattern) return;
    if (pattern.type === "Identifier") current.names.add(pattern.name!);
    else if (pattern.type === "RestElement")
      bind(child(pattern.argument), current);
    else if (pattern.type === "AssignmentPattern")
      bind(child(pattern.left), current);
    else if (pattern.type === "ArrayPattern")
      (pattern.elements as Ast[]).forEach((value) => bind(value, current));
    else if (pattern.type === "ObjectPattern")
      (pattern.properties as Ast[]).forEach((property) =>
        bind(
          child(
            property.type === "RestElement"
              ? property.argument
              : property.value,
          ),
          current,
        ),
      );
  }
  function patternExpressions(pattern: Ast | undefined, current: Scope): void {
    if (!pattern) return;
    if (pattern.type === "AssignmentPattern") {
      visit(child(pattern.right), current);
      patternExpressions(child(pattern.left), current);
    } else if (pattern.type === "RestElement")
      patternExpressions(child(pattern.argument), current);
    else if (pattern.type === "ArrayPattern")
      (pattern.elements as Ast[]).forEach((value) =>
        patternExpressions(value, current),
      );
    else if (pattern.type === "ObjectPattern")
      for (const property of pattern.properties as Ast[]) {
        if (property.computed) visit(child(property.key), current);
        patternExpressions(
          child(
            property.type === "RestElement"
              ? property.argument
              : property.value,
          ),
          current,
        );
      }
  }
  function visit(
    node: Ast | undefined,
    current: Scope,
    parent?: Ast,
    key?: string,
  ): void {
    if (!node) return;
    if (node.type === "ImportExpression" || node.type === "ImportDeclaration")
      fail(node.loc?.start.line ?? 1, "Imports are unavailable");
    if (
      /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(
        node.type,
      )
    ) {
      if (node.type === "FunctionDeclaration") bind(child(node.id), current);
      const inner = scope(current, true);
      bind(child(node.id), inner);
      for (const parameter of node.params as Ast[]) bind(parameter, inner);
      for (const parameter of node.params as Ast[])
        patternExpressions(parameter, inner);
      visit(child(node.body), inner);
      return;
    }
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      if (node.type === "ClassDeclaration") bind(child(node.id), current);
      visit(child(node.superClass), current);
      const inner = scope(current);
      bind(child(node.id), inner);
      visit(child(node.body), inner);
      return;
    }
    if (node.type === "VariableDeclaration") {
      let target = current;
      if (node.kind === "var")
        while (target.parent && !target.functionScope) target = target.parent;
      for (const declaration of node.declarations as Ast[])
        bind(child(declaration.id), target);
      for (const declaration of node.declarations as Ast[]) {
        patternExpressions(child(declaration.id), current);
        visit(child(declaration.init), current);
      }
      return;
    }
    if (node.type === "CatchClause") {
      const inner = scope(current);
      bind(child(node.param), inner);
      visit(child(node.body), inner);
      return;
    }
    if (
      [
        "BlockStatement",
        "ForStatement",
        "ForInStatement",
        "ForOfStatement",
        "SwitchStatement",
      ].includes(node.type)
    )
      current = scope(current);
    if (node.type === "Identifier") {
      const property =
        parent &&
        ((parent.type === "MemberExpression" &&
          key === "property" &&
          !parent.computed) ||
          (["Property", "MethodDefinition", "PropertyDefinition"].includes(
            parent.type,
          ) &&
            key === "key" &&
            !parent.computed) ||
          (["LabeledStatement", "BreakStatement", "ContinueStatement"].includes(
            parent.type,
          ) &&
            key === "label"));
      const safeTypeof =
        parent?.type === "UnaryExpression" && parent.operator === "typeof";
      if (!property && !safeTypeof && unsupported.has(node.name!))
        references.push({ node, scope: current, name: node.name! });
      return;
    }
    if (node.type === "MemberExpression") {
      const object = child(node.object),
        property = child(node.property);
      const name = node.computed ? property.value : property.name;
      if (
        object.type === "Identifier" &&
        ["self", "globalThis"].includes(object.name!) &&
        typeof name === "string" &&
        unsupported.has(name)
      ) {
        members.push({
          node,
          scope: current,
          object: object.name!,
          property: name,
        });
      }
    }
    for (const [name, value] of Object.entries(node)) {
      if (Array.isArray(value))
        for (const item of value) {
          if (item && typeof item.type === "string")
            visit(item, current, node, name);
        }
      else if (value && typeof value === "object" && "type" in value)
        visit(child(value), current, node, name);
    }
  }
  visit(tree, scope(undefined, true));
  // Resolve after collecting declarations so hoisted/local bindings are not treated as globals.
  for (const reference of references)
    if (!bound(reference.name, reference.scope))
      fail(
        reference.node.loc?.start.line ?? 1,
        `Unavailable global ${reference.name}`,
      );
  for (const member of members)
    if (!bound(member.object, member.scope))
      fail(
        member.node.loc?.start.line ?? 1,
        `Unavailable API ${member.object}.${member.property}`,
      );
}

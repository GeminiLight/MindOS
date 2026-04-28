/**
 * Recursively widen literal string types to `string` so zh values can differ from en.
 *
 * Without Widen<T>, TypeScript would require zh strings to be the *exact* literal values from en.
 * E.g., if en has `common: { hello: "hello" as const }`, zh would be required to also have "hello".
 *
 * This type converts all string literals to generic `string`, allowing Chinese translations to use
 * completely different values while maintaining structure compatibility.
 *
 * Example:
 * ```
 * en = { msg: "Hello" as const }                // string literal "Hello"
 * zh_without = { msg: "你好" } satisfies typeof en  // ❌ ERROR: "你好" not assignable to "Hello"
 * zh_with = { msg: "你好" } satisfies Widen<typeof en>  // ✅ OK: string satisfies string
 * ```
 */
export type Widen<T> =
  T extends string ? string :
  T extends readonly (infer U)[] ? readonly Widen<U>[] :
  T extends (...args: infer A) => infer R ? (...args: A) => Widen<R> :
  T extends object ? { [K in keyof T]: Widen<T[K]> } :
  T;

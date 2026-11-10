// A schema field named like a registered helper. In a template, `{{id}}` calls the helper `id` whenever one
// is registered, before it would read a field of that name, so such a field can never be shown by its name.
// Every property name is checked, at any depth (`properties`, and `items` with theirs: inside `{{#each}}`
// an item's fields are read by their bare names too), against every helper the render environment has:
// Handlebars' own, Pattern Dump's, and the project's. Checked at render, beside the placement extensions,
// so the problem shows on its component in the workbench; a storefront page whose layout has it fails.

/** One problem, with the JSON pointer of the property it is about. */
export interface SchemaHelperNameProblem { path: string; message: string }

const HELPER_NAME = "is the name of a registered helper";
type Prop = Record<string, unknown>;
const isObject = (v: unknown): v is Prop => typeof v === "object" && v !== null && !Array.isArray(v);

/** Every property of `schema`, at any depth, whose name is one of `helpers`. */
export function checkSchemaHelperNames(schema: unknown, helpers: Iterable<string>): SchemaHelperNameProblem[] {
  const names = new Set(helpers);
  const problems: SchemaHelperNameProblem[] = [];
  const walk = (node: Prop, path: string): void => {
    if (isObject(node["properties"])) {
      for (const [name, prop] of Object.entries(node["properties"])) {
        const at = `${path}/properties/${name}`;
        if (names.has(name)) {
          problems.push({ path: at, message: `"${name}" ${HELPER_NAME}, so {{${name}}} would call the helper, not read this field` });
        }
        if (isObject(prop)) walk(prop, at);
      }
    }
    if (isObject(node["items"])) walk(node["items"], `${path}/items`);
  };
  if (isObject(schema)) walk(schema, "#");
  return problems;
}

/** Whether a diagnostic's message is one of `checkSchemaHelperNames`' problems. */
export const isHelperNameProblem = (message: string): boolean => message.includes(`" ${HELPER_NAME}, so {{`);

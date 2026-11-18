// markdown-it-deflist 4.0.0 ships no type declarations, and there is no @types package for it.
declare module "markdown-it-deflist" {
  import type { PluginSimple } from "markdown-it";
  const deflist: PluginSimple;
  export default deflist;
}

// esbuild bundles *.html with --loader:.html=text, which yields the file's contents as a string.
declare module "*.html" {
  const html: string;
  export default html;
}

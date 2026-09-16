// Guard fixture for the project helper loader (config.helpers).
// CJS registrar — the exact PatternLab/hTWOo shape: module.exports = (Handlebars) => { … }.
// (test-bench is "type": "module", so this must be .cjs to be CommonJS.)
module.exports = function (Handlebars) {
  // A plain value helper. An unregistered helper makes Handlebars throw and blanks the pattern,
  // so a component using this renders ONLY when the loader wired it.
  Handlebars.registerHelper("tbShout", function (value) {
    return String(value).toUpperCase();
  });

  // A DYNAMIC partial: it reads Handlebars.partials / .compile at CALL time — which only works when
  // the registrar was invoked with the renderer's real env (not a captured shim). This is the
  // dynamic-composition edge DIFFERENTIATION admits: it renders, but by design it produces NO static
  // composition edge (the composition registry only sees `{{> … }}`, never a runtime string lookup).
  Handlebars.registerHelper("tbDynamicPartial", function (name, context) {
    const partial = Handlebars.partials[name];
    if (!partial) return `[no partial: ${name}]`;
    const tpl = typeof partial === "function" ? partial : Handlebars.compile(partial);
    return new Handlebars.SafeString(tpl(context));
  });
};

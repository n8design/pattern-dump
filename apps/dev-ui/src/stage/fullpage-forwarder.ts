// The full-page preview's key/activity forwarder.
//
// A <script> spliced into the preview's srcdoc so ESC and pointer activity reach the shell across
// the document boundary. It is appended to the srcdoc STRING rather than injected into the live
// document, because srcdoc is re-set on every open and on every HMR content-swap — anything added
// to the document afterwards would be wiped by the next set.
//
// This is the shell's only HTML manipulation by string surgery. `withForwarder` splices before
// </body> when one exists and otherwise appends, which is what keeps it safe against a preview
// document that has no body tag at all.
//
// NOTE on the honest-UA-page contract (CONTRIBUTING.md, "The preview is an honest page"): the shell injects nothing into the preview's
// srcdoc — no stylesheet links, no inline styles, no reset. This forwarder is not an exception. That
// rule governs STYLING the preview document; this adds the behaviour the shell needs to receive
// events across the iframe boundary, and it paints nothing.

// Appended to the srcdoc string so it re-establishes on every srcdoc set (open + HMR).
// ESC → postMessage exit; pointer/touch activity → postMessage active (throttled to 100ms).
//
// The `<\/script>` at the end keeps its backslash deliberately: this string is injected into a
// document inside a <script> block, and an unescaped </script> would terminate that block early.
// Redundant to the JS string parser, required by the HTML parser — hence the rule is off here.
/* eslint-disable no-useless-escape */
export const FORWARDER = `<script>(function(){
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){e.preventDefault();window.parent.postMessage({type:'pd-fp',action:'exit'},'*');}
  });
  var _l=0;
  function _a(){var n=Date.now();if(n-_l<100)return;_l=n;window.parent.postMessage({type:'pd-fp',action:'active'},'*');}
  document.addEventListener('pointermove',_a);
  document.addEventListener('pointerdown',_a);
  document.addEventListener('touchstart',_a,{passive:true});
})();<\/script>`;
/* eslint-enable no-useless-escape */

export function withForwarder(doc: string): string {
  return doc.includes('</body>') ? doc.replace('</body>', FORWARDER + '</body>') : doc + FORWARDER;
}

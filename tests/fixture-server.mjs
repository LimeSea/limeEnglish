import { createServer } from "node:http";

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Context fixture</title></head><body>
  <main>
    <h1>Life Along the River</h1>
    <p id="previous">The walking path follows the water through the old town.</p>
    <p id="sentence">Earlier sentence. <span>Dr. Lee sat on the <strong id="bank">bank</strong> and watched the river flow.</span> Final sentence.</p>
    <p id="next">A small <strong id="boat">boat</strong> passed beneath the stone bridge.</p>
    <p id="edge-selection">A <span id="possibility">possibility </span>remains.</p>
    <input id="input" value="bank">
    <div id="editable" contenteditable="true">bank</div>
    <code id="code">bank</code>
    <p id="multi">river bank</p>
    <p style="display:none"><span id="hidden">bank</span></p>
  </main>
</body></html>`;

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});
server.listen(4173, "127.0.0.1");

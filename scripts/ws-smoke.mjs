// WS smoke test: spawn a bash PTY, send `echo hello`, expect output back.
import WebSocket from "ws";

const token = process.argv[2];
const ws = new WebSocket(`ws://127.0.0.1:4277/ws?token=${token}`);
let agentId = null;
let saw = "";

ws.on("open", () => {
  ws.send(JSON.stringify({ cmd: "spawn_agent", name: "t1", command: "bash", cwd: "." }));
});

ws.on("message", (data, isBinary) => {
  if (isBinary) {
    const len = data[0];
    const id = data.subarray(1, 1 + len).toString();
    const payload = data.subarray(1 + len).toString();
    saw += payload;
    if (saw.includes("canvas-hello")) {
      console.log("PTY OUTPUT OK:", JSON.stringify(saw.slice(-80)));
      process.exit(0);
    }
    if (agentId && !saw.includes("echo canvas-hello")) {
      ws.send(JSON.stringify({
        cmd: "pty_input",
        agent_id: agentId,
        data: Buffer.from("echo canvas-hello\n").toString("base64"),
      }));
    }
    return;
  }
  const msg = JSON.parse(data.toString());
  console.log("ctrl:", JSON.stringify(msg));
  if (msg.type === "spawned") {
    agentId = msg.agent_id;
    ws.send(JSON.stringify({
      cmd: "pty_input",
      agent_id: agentId,
      data: Buffer.from("echo canvas-hello\n").toString("base64"),
    }));
  }
});

ws.on("error", (e) => { console.error("WS ERR", e); process.exit(1); });
setTimeout(() => { console.error("TIMEOUT; saw:", JSON.stringify(saw.slice(-200))); process.exit(1); }, 15000);

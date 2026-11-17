"""One-shot local llama.cpp server requests; model output stays separate from logs."""
import base64
import json
import mimetypes
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


def media_content(kind, file, prompt):
    file = Path(file)
    data = base64.b64encode(file.read_bytes()).decode("ascii")
    media = ({"type": "input_audio", "input_audio": {"data": data, "format": "wav"}} if kind == "caption"
             else {"type": "image_url", "image_url": {"url": f"data:{mimetypes.guess_type(file.name)[0] or 'image/png'};base64,{data}"}})
    return [{"type": "text", "text": prompt}, media]


def infer(binary, model, projector, kind, file, prompt, tokens, context, threads, out):
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    command = [str(binary), "--model", str(model), "--mmproj", str(projector), "--host", "127.0.0.1",
               "--port", str(port), "-c", str(context), "-t", str(threads), "--parallel", "1", "--log-disable"]
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    timeout = float(os.environ.get("MC_MEDIA_TIMEOUT_SECONDS", "300"))
    with (out / "server.log").open("w", encoding="utf-8") as log:
        server = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                                  creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        try:
            deadline = time.monotonic() + min(90, timeout)
            while True:
                if server.poll() is not None:
                    raise RuntimeError(f"local model server exited {server.returncode}; inspect server.log")
                try:
                    with opener.open(f"http://127.0.0.1:{port}/health", timeout=2) as response:
                        if response.status == 200:
                            break
                except (OSError, urllib.error.URLError):
                    if time.monotonic() >= deadline:
                        raise TimeoutError("local model server did not become ready; inspect server.log")
                    time.sleep(0.1)
            payload = {"messages": [{"role": "user", "content": media_content(kind, file, prompt)}],
                       "max_tokens": tokens, "temperature": 0, "stream": False, "seed": 0}
            request = urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions",
                                             data=json.dumps(payload).encode("utf-8"),
                                             headers={"Content-Type": "application/json"})
            with opener.open(request, timeout=timeout) as response:
                result = json.load(response)
            (out / "response.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            return result, command
        finally:
            if server.poll() is None:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=5)

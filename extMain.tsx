/// <reference path="./node_modules/@types/chrome/index.d.ts" />
import preact from "preact";
import { Layout } from "./src/Layout";
import { observable } from "./src/mobxTyped";
import { isInBrowser, isInServiceWorker } from "./src/helpers";



if (isInBrowser()) {
    window.process = {
        env: {
        }
    } as any;
}

if (isInBrowser()) {
    // NOTE: This run in production, which causes to try to connect to a random websocket. HOWEVER,
    //  1, we don't do anything with it (if it fails, etc, it won't break anything, and 2, it is no
    //  less harmless than any of the dozens of blocked tracking requests. Failed requests are FAST.
    const socket = new WebSocket("ws://localhost:8080");

    socket.onmessage = function (event) {
        if (event.data === "Build completed successfully") {
            location.reload();
        }
    };

    document.body.innerHTML = "";
    preact.render(<Layout />, document.body);
}
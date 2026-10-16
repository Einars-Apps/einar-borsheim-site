import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { nativeHttpGet } from "../www/js/native-http.js";
import { frostGet } from "../www/js/frost.js";

const config = JSON.parse(fs.readFileSync(new URL("../capacitor.config.json", import.meta.url), "utf8"));
const app = fs.readFileSync(new URL("../www/app.js", import.meta.url), "utf8");
const firestore = fs.readFileSync(new URL("../www/js/firestore-read.js", import.meta.url), "utf8");

test("CapacitorHttp lapper ikke XHR, Frost kaller request direkte", async () => {
  assert.equal(config.plugins.CapacitorHttp.enabled, false);
  const calls = [];
  const data = await frostGet("https://frost.met.no/obs", "client", {
    plugin: {
      request: async (options) => {
        calls.push(options);
        return { status: 200, data: { ok: true } };
      },
    },
  });
  assert.equal(data.ok, true);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].url, "https://frost.met.no/obs");
  assert.match(calls[0].headers.Authorization, /^Basic /);
});

test("uten native plugin brukes vanlig fetch", async () => {
  const result = await nativeHttpGet("https://ws.geonorge.no/adresser", {}, {
    plugin: null,
    fetchImpl: async () => ({ status: 200, json: async () => ({ adresser: [] }) }),
  });
  assert.equal(result.via, "fetch");
  assert.deepEqual(result.data, { adresser: [] });
});

test("kallbare funksjoner og Storage går utenom CapacitorHttp", () => {
  assert.match(app, /fetch\(`https:\/\/europe-west1-einar-borsheim-internkon-ee8b6\.cloudfunctions\.net\/\$\{name\}`/);
  assert.match(app, /storage\.ref\([\s\S]{0,80}\)\.put\(/);
  assert.equal(app.includes("CapacitorHttp"), false);
  assert.match(firestore, /experimentalForceLongPolling: true/);
});

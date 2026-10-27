import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../samtykke.js", import.meta.url), "utf8");
const script = readFileSync(new URL("../script.js", import.meta.url), "utf8");
const form = readFileSync(new URL("../henvendelse.js", import.meta.url), "utf8");

function load(stored) {
  const dataLayer = [];
  const context = {
    localStorage: {
      getItem(key) { return key === "samtykke" ? stored : null; },
    },
  };
  context.window = context;
  context.window.dataLayer = dataLayer;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { dataLayer, window: context.window };
}

function rows(dataLayer) {
  return dataLayer.map((entry) => Array.from(entry));
}

test("uten samtykke settes ikke Google Ads-config", () => {
  const { dataLayer } = load("");
  const commands = rows(dataLayer).map((row) => row.slice(0, 2).join(" "));
  assert.equal(commands.includes("config AW-18535455222"), false);
  assert.ok(commands.includes("config G-XCQTBQVK7C"));
  assert.equal(rows(dataLayer)[0][2].ad_storage, "denied");
});

test("med lagret samtykke kommer Ads-config etter granted", () => {
  const { dataLayer } = load("godtatt");
  const flat = rows(dataLayer);
  const granted = flat.findIndex((row) => row[0] === "consent" && row[1] === "update" && row[2].ad_storage === "granted");
  const ads = flat.findIndex((row) => row[0] === "config" && row[1] === "AW-18535455222");
  assert.ok(granted >= 0);
  assert.ok(ads > granted);
});

test("samtykke sender konvertering med etikett, verdi og valuta", () => {
  const expected = {
    telefon: "AW-18535455222/rEGGCLPcxqsdEPazsoZF",
    epost: "AW-18535455222/ZqFTCLbcxqsdEPazsoZF",
    skjema: "AW-18535455222/gOXVCLDcxqsdEPazsoZF",
  };
  const { dataLayer, window: root } = load("godtatt");
  for (const key of Object.keys(expected)) {
    root.adsKonvertering(key);
    const last = Array.from(dataLayer.at(-1));
    assert.equal(last[0], "event");
    assert.equal(last[1], "conversion");
    assert.equal(last[2].send_to, expected[key]);
    assert.equal(last[2].value, 1.0);
    assert.equal(last[2].currency, "NOK");
  }
  assert.match(source, new RegExp(expected.telefon));
  assert.match(source, new RegExp(expected.epost));
  assert.match(source, new RegExp(expected.skjema));
  assert.doesNotMatch(source, /LABEL_/);
});

test("avslag sender ikke konvertering", () => {
  const { dataLayer, window: root } = load("avslatt");
  const before = dataLayer.length;
  root.adsKonvertering("telefon");
  root.adsKonvertering("epost");
  root.adsKonvertering("skjema");
  assert.equal(dataLayer.length, before);
  assert.equal(rows(dataLayer).some((row) => row[1] === "AW-18535455222"), false);
});

test("klikk og skjema kaller Ads ved siden av de gamle GA4-hendelsene", () => {
  assert.match(script, /klikk_telefon/);
  assert.match(script, /adsKonvertering\("telefon"\)/);
  assert.match(script, /klikk_epost/);
  assert.match(script, /adsKonvertering\("epost"\)/);
  assert.match(script, /konfigurerGoogleAds\(\)/);
  assert.match(form, /generate_lead/);
  assert.match(form, /adsKonvertering\("skjema"\)/);
  assert.doesNotMatch(readFileSync(new URL("../www/index.html", import.meta.url), "utf8"), /samtykke\.js/);
});

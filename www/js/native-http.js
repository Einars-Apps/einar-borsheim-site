export function capacitorHttpPlugin(cap = globalThis.Capacitor) {
  const plugin = cap?.Plugins?.CapacitorHttp;
  return typeof plugin?.request === "function" ? plugin : null;
}

export async function nativeHttpGet(url, headers, { plugin, fetchImpl } = {}) {
  const http = plugin && typeof plugin.request === "function" ? plugin : null;
  if (http) {
    const response = await http.request({
      url,
      method: "GET",
      headers,
      responseType: "json",
    });
    const status = Number(response?.status || 0);
    const data = typeof response?.data === "string" && response.data
      ? JSON.parse(response.data)
      : response?.data;
    return { status, data };
  }
  const fetchFn = fetchImpl || globalThis.fetch;
  const response = await fetchFn(url, { headers });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, via: "fetch" };
}

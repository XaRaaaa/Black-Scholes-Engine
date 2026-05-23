const defaultHeaders = {
  "Content-Type": "application/json"
};

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

function buildUrl(path) {
  return `${apiBaseUrl}${path}`;
}

async function request(path, payload) {
  const response = await fetch(buildUrl(path), {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Request failed");
  }

  return response.json();
}

export function fetchPrice(payload) {
  return request("/api/price", payload);
}

export function fetchCurve(payload) {
  return request("/api/curve", payload);
}

export function fetchHistory(payload) {
  return request("/api/history", payload);
}

export function fetchOptions(payload) {
  return request("/api/options", payload);
}

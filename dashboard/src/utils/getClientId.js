export function getClientId() {
  if (typeof window === "undefined") return null;
  let clientId = localStorage.getItem("cuhz_client_id");
  if (!clientId) {
    clientId = "client_" + Math.random().toString(36).substr(2, 9);
    localStorage.setItem("cuhz_client_id", clientId);
  }
  return clientId;
}

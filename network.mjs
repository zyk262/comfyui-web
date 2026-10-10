import http from 'node:http';
import net from 'node:net';

export async function enableProxy(proxyUrl) {
  if (!proxyUrl || typeof http.setGlobalProxyFromEnv !== 'function') return false;
  const url = new URL(proxyUrl);
  const available = await new Promise(resolve => {
    const socket = net.createConnection({ host: url.hostname, port: Number(url.port || 80) });
    const finish = result => { socket.destroy(); resolve(result); };
    socket.setTimeout(1200, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
  if (!available) return false;
  http.setGlobalProxyFromEnv({ HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, NO_PROXY: 'localhost,127.0.0.1,::1' });
  return true;
}

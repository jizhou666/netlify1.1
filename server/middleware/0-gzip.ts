/**
 * 运行时 gzip 压缩中间件（本机正式托管专用）。
 *
 * 台账全量 600+ 行内联进 SSR HTML 约 2MB，经 cpolar 免费隧道（实测下行
 * ~130KB/s）首屏要 15 秒以上，server 函数的 JSON 响应同样体积巨大，
 * 表现为"点什么都没反应"。gzip 把 HTML/JSON 压到 ~10%，加载从十几秒
 * 降到一两秒。
 *
 * 注册名以 0 开头：Nitro 按文件名顺序执行 server/middleware/*，本中间件
 * 包在最外层，grok-pwa 仍在其内侧处理未压缩 HTML。浏览器与 fetch/XHR
 * 对 content-encoding: gzip 自动解压，前端无需感知。
 */

const COMPRESSIBLE = ["text/html", "application/json", "text/plain", "text/css"];

interface GzipEvent {
  req: Request;
}

export default async function gzipMiddleware(
  event: GzipEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const result = await next();
  if (!(result instanceof Response)) return result;
  if (!result.body) return result;

  const acceptEncoding = event.req.headers.get("accept-encoding") ?? "";
  if (!acceptEncoding.includes("gzip")) return result;

  const contentType = (result.headers.get("content-type") ?? "").toLowerCase();
  if (!COMPRESSIBLE.some((t) => contentType.includes(t))) return result;
  if (result.headers.get("content-encoding")) return result;

  // 小响应（探测请求等）直接透传，省 CPU 与协商开销。
  const declaredLength = Number(result.headers.get("content-length") ?? "0");
  if (declaredLength > 0 && declaredLength < 1024) return result;

  const headers = new Headers(result.headers);
  headers.set("content-encoding", "gzip");
  headers.delete("content-length");
  const vary = headers.get("vary");
  headers.set("vary", vary && !vary.includes("Accept-Encoding") ? `${vary}, Accept-Encoding` : "Accept-Encoding");

  const compressed = result.body.pipeThrough(new CompressionStream("gzip"));
  return new Response(compressed, {
    status: result.status,
    statusText: result.statusText,
    headers,
  });
}

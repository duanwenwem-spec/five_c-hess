/**
 * Cloudflare Pages API gateway.
 *
 * Visitors use the pages.dev hostname while API requests travel to the
 * existing Worker through Cloudflare's private service binding.
 */
export async function onRequest(context) {
  if (!context.env.BACKEND) {
    return new Response(JSON.stringify({ error: "联机服务尚未绑定" }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  return context.env.BACKEND.fetch(context.request);
}

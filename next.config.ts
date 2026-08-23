import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static"],
  async headers(){return[{source:"/sw.js",headers:[{key:"Content-Type",value:"application/javascript; charset=utf-8"},{key:"Cache-Control",value:"no-cache, no-store, must-revalidate"},{key:"Content-Security-Policy",value:"default-src 'self'; script-src 'self'"}]},{source:"/api/admin/join-requests/:path*",headers:[{key:"Access-Control-Allow-Origin",value:"*"},{key:"Access-Control-Allow-Methods",value:"GET, POST, OPTIONS"},{key:"Access-Control-Allow-Headers",value:"Authorization, Content-Type"}]},{source:"/:path*",headers:[{key:"X-Content-Type-Options",value:"nosniff"},{key:"X-Frame-Options",value:"DENY"},{key:"Referrer-Policy",value:"strict-origin-when-cross-origin"}]}]},
};

export default nextConfig;

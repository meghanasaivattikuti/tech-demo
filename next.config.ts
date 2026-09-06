import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // page-level revalidate can't express per-record invalidation (it's one
  // number for the whole page), which is the whole point of this project -
  // cacheTag('record-${id}') per record is what actually gets us there
  cacheComponents: true,

  // mssql picks its SQL types by reference identity (switch on
  // TYPES.NVarChar etc), and Turbopack's default bundling can end up with
  // two copies of the module, so the identity check silently fails and
  // parameter binding breaks only inside next dev/build, never in a plain
  // node script. marking it external keeps one module instance
  serverExternalPackages: ["mssql"],
};

export default nextConfig;

/** Refuse to spill downloads onto a VM root disk when NFS is missing. */

export function resolveDownloadDir(nfsMounted: boolean, requested: string): string {
  if (!requested.startsWith("/mnt/downloads")) {
    throw new Error("Downloads may only be written under /mnt/downloads.");
  }
  if (requested.includes("..")) {
    throw new Error("Download path is not allowed.");
  }
  if (!nfsMounted) {
    throw new Error("NFS is not mounted. Refusing to write downloads onto the VM disk.");
  }
  return requested;
}
